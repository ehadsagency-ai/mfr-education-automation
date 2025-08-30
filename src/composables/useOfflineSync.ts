import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useNetwork } from '@vueuse/core'

export interface OfflineAction {
  id: string
  type: 'create' | 'update' | 'delete'
  resource: string
  data: any
  timestamp: Date
  retryCount: number
  maxRetries: number
  status: 'pending' | 'syncing' | 'failed' | 'completed'
}

export interface SyncResult {
  success: boolean
  syncedCount: number
  failedCount: number
  errors: Array<{ actionId: string; error: string }>
}

export interface OfflineSyncConfig {
  maxRetries: number
  retryDelay: number
  autoSync: boolean
  batchSize: number
  priorityResources: string[]
}

/**
 * Composable pour la synchronisation offline-first
 * Gère la queue d'actions offline et la synchronisation automatique
 */
export function useOfflineSync(config?: Partial<OfflineSyncConfig>) {
  const defaultConfig: OfflineSyncConfig = {
    maxRetries: 3,
    retryDelay: 5000,
    autoSync: true,
    batchSize: 10,
    priorityResources: ['students', 'courses', 'users'],
    ...config
  }

  // États
  const network = useNetwork()
  const offlineQueue = ref<OfflineAction[]>([])
  const isSyncing = ref(false)
  const lastSyncTime = ref<Date | null>(null)
  const syncInProgress = ref<Set<string>>(new Set())

  // Base de données locale (IndexedDB)
  const dbName = 'mfr-offline-db'
  const dbVersion = 1
  let db: IDBDatabase | null = null

  // Computed
  const isOnline = computed(() => network.value.isOnline)
  const hasOfflineData = computed(() => offlineQueue.value.length > 0)
  const pendingActions = computed(() => 
    offlineQueue.value.filter(action => action.status === 'pending')
  )
  const failedActions = computed(() => 
    offlineQueue.value.filter(action => action.status === 'failed')
  )

  /**
   * Initialise la base de données IndexedDB
   */
  const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, dbVersion)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        
        // Store pour les actions offline
        if (!db.objectStoreNames.contains('offlineActions')) {
          const actionStore = db.createObjectStore('offlineActions', { keyPath: 'id' })
          actionStore.createIndex('resource', 'resource', { unique: false })
          actionStore.createIndex('status', 'status', { unique: false })
          actionStore.createIndex('timestamp', 'timestamp', { unique: false })
        }

        // Store pour les données en cache
        if (!db.objectStoreNames.contains('cachedData')) {
          const cacheStore = db.createObjectStore('cachedData', { keyPath: 'id' })
          cacheStore.createIndex('resource', 'resource', { unique: false })
          cacheStore.createIndex('lastModified', 'lastModified', { unique: false })
        }

        // Store pour les métadonnées de sync
        if (!db.objectStoreNames.contains('syncMeta')) {
          db.createObjectStore('syncMeta', { keyPath: 'key' })
        }
      }
    })
  }

  /**
   * Ajoute une action à la queue offline
   */
  const addOfflineAction = async (
    type: OfflineAction['type'],
    resource: string,
    data: any,
    options?: { priority?: boolean; maxRetries?: number }
  ): Promise<string> => {
    const actionId = `${type}-${resource}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    const action: OfflineAction = {
      id: actionId,
      type,
      resource,
      data,
      timestamp: new Date(),
      retryCount: 0,
      maxRetries: options?.maxRetries ?? defaultConfig.maxRetries,
      status: 'pending'
    }

    // Ajouter en priorité si spécifié
    if (options?.priority) {
      offlineQueue.value.unshift(action)
    } else {
      offlineQueue.value.push(action)
    }

    // Sauvegarder en IndexedDB
    await saveActionToDB(action)

    // Tenter la sync immédiatement si online
    if (isOnline.value && defaultConfig.autoSync) {
      await syncOfflineActions()
    }

    return actionId
  }

  /**
   * Sauvegarde une action en base de données locale
   */
  const saveActionToDB = async (action: OfflineAction): Promise<void> => {
    if (!db) return

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['offlineActions'], 'readwrite')
      const store = transaction.objectStore('offlineActions')
      const request = store.put(action)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Charge les actions depuis IndexedDB
   */
  const loadActionsFromDB = async (): Promise<OfflineAction[]> => {
    if (!db) return []

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['offlineActions'], 'readonly')
      const store = transaction.objectStore('offlineActions')
      const request = store.getAll()

      request.onsuccess = () => {
        const actions = request.result.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        resolve(actions)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Synchronise toutes les actions offline
   */
  const syncOfflineActions = async (): Promise<SyncResult> => {
    if (!isOnline.value || isSyncing.value) {
      return { success: false, syncedCount: 0, failedCount: 0, errors: [] }
    }

    isSyncing.value = true
    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      errors: []
    }

    try {
      // Trier par priorité et timestamp
      const actionsToSync = [...pendingActions.value]
        .sort((a, b) => {
          // Priorité aux resources critiques
          const aPriority = defaultConfig.priorityResources.includes(a.resource) ? 1 : 0
          const bPriority = defaultConfig.priorityResources.includes(b.resource) ? 1 : 0
          
          if (aPriority !== bPriority) {
            return bPriority - aPriority
          }
          
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        })

      // Traiter par batch
      for (let i = 0; i < actionsToSync.length; i += defaultConfig.batchSize) {
        const batch = actionsToSync.slice(i, i + defaultConfig.batchSize)
        
        await Promise.all(batch.map(async (action) => {
          try {
            action.status = 'syncing'
            syncInProgress.value.add(action.id)

            await executeOfflineAction(action)
            
            action.status = 'completed'
            result.syncedCount++

            // Supprimer de la queue et de la DB
            await removeActionFromDB(action.id)
            const index = offlineQueue.value.findIndex(a => a.id === action.id)
            if (index !== -1) {
              offlineQueue.value.splice(index, 1)
            }

          } catch (error) {
            action.retryCount++
            
            if (action.retryCount >= action.maxRetries) {
              action.status = 'failed'
              result.failedCount++
              result.errors.push({
                actionId: action.id,
                error: error instanceof Error ? error.message : 'Unknown error'
              })
            } else {
              action.status = 'pending'
              // Programmer un retry avec délai exponentiel
              setTimeout(() => {
                syncOfflineActions()
              }, defaultConfig.retryDelay * Math.pow(2, action.retryCount - 1))
            }

            await saveActionToDB(action)
          } finally {
            syncInProgress.value.delete(action.id)
          }
        }))
      }

      lastSyncTime.value = new Date()
      await saveSyncMetadata('lastSyncTime', lastSyncTime.value)

    } catch (error) {
      result.success = false
      console.error('Sync failed:', error)
    } finally {
      isSyncing.value = false
    }

    return result
  }

  /**
   * Exécute une action offline contre l'API
   */
  const executeOfflineAction = async (action: OfflineAction): Promise<void> => {
    const { type, resource, data } = action
    
    let response: Response
    const apiBaseUrl = '/api'
    
    switch (type) {
      case 'create':
        response = await fetch(`${apiBaseUrl}/${resource}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
          },
          body: JSON.stringify(data)
        })
        break

      case 'update':
        response = await fetch(`${apiBaseUrl}/${resource}/${data.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
          },
          body: JSON.stringify(data)
        })
        break

      case 'delete':
        response = await fetch(`${apiBaseUrl}/${resource}/${data.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        })
        break

      default:
        throw new Error(`Unknown action type: ${type}`)
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Mettre à jour le cache local avec la réponse
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const responseData = await response.json()
      await updateLocalCache(resource, data.id || responseData.id, responseData)
    }
  }

  /**
   * Supprime une action de la base de données
   */
  const removeActionFromDB = async (actionId: string): Promise<void> => {
    if (!db) return

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['offlineActions'], 'readwrite')
      const store = transaction.objectStore('offlineActions')
      const request = store.delete(actionId)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Met à jour le cache local
   */
  const updateLocalCache = async (resource: string, id: string, data: any): Promise<void> => {
    if (!db) return

    const cacheEntry = {
      id: `${resource}-${id}`,
      resource,
      data,
      lastModified: new Date()
    }

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['cachedData'], 'readwrite')
      const store = transaction.objectStore('cachedData')
      const request = store.put(cacheEntry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Récupère des données du cache local
   */
  const getFromLocalCache = async (resource: string, id?: string): Promise<any> => {
    if (!db) return null

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['cachedData'], 'readonly')
      const store = transaction.objectStore('cachedData')
      
      if (id) {
        const request = store.get(`${resource}-${id}`)
        request.onsuccess = () => resolve(request.result?.data || null)
        request.onerror = () => reject(request.error)
      } else {
        const index = store.index('resource')
        const request = index.getAll(resource)
        request.onsuccess = () => {
          const results = request.result.map(entry => entry.data)
          resolve(results)
        }
        request.onerror = () => reject(request.error)
      }
    })
  }

  /**
   * Sauvegarde les métadonnées de sync
   */
  const saveSyncMetadata = async (key: string, value: any): Promise<void> => {
    if (!db) return

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['syncMeta'], 'readwrite')
      const store = transaction.objectStore('syncMeta')
      const request = store.put({ key, value })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Force une synchronisation manuelle
   */
  const forcSync = async (): Promise<SyncResult> => {
    return await syncOfflineActions()
  }

  /**
   * Vide la queue offline
   */
  const clearOfflineQueue = async (): Promise<void> => {
    offlineQueue.value = []
    
    if (!db) return

    return new Promise((resolve, reject) => {
      const transaction = db!.transaction(['offlineActions'], 'readwrite')
      const store = transaction.objectStore('offlineActions')
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Obtient le token d'authentification
   */
  const getAuthToken = (): string => {
    return localStorage.getItem('auth_token') || ''
  }

  /**
   * Gère les changements de statut réseau
   */
  watch(isOnline, (online) => {
    if (online && defaultConfig.autoSync && hasOfflineData.value) {
      // Attendre un peu avant de syncer après reconnexion
      setTimeout(() => {
        syncOfflineActions()
      }, 1000)
    }
  })

  // Initialisation
  onMounted(async () => {
    try {
      db = await initDB()
      const savedActions = await loadActionsFromDB()
      offlineQueue.value = savedActions.filter(action => action.status !== 'completed')

      // Sync automatique si online
      if (isOnline.value && defaultConfig.autoSync && hasOfflineData.value) {
        await syncOfflineActions()
      }

    } catch (error) {
      console.error('Failed to initialize offline sync:', error)
    }
  })

  onUnmounted(() => {
    if (db) {
      db.close()
    }
  })

  return {
    // États
    isOnline: readonly(isOnline),
    hasOfflineData: readonly(hasOfflineData),
    isSyncing: readonly(isSyncing),
    lastSyncTime: readonly(lastSyncTime),
    offlineQueue: readonly(offlineQueue),
    pendingActions: readonly(pendingActions),
    failedActions: readonly(failedActions),

    // Méthodes
    addOfflineAction,
    syncOfflineActions,
    forcSync,
    clearOfflineQueue,
    getFromLocalCache,
    updateLocalCache
  }
}