/**
 * 📱 Composable useOffline
 * Gestion intelligente du mode offline et synchronisation
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotification } from './useNotification'

interface OfflineAction {
  id: string
  type: 'student_note' | 'student_observation' | 'content_request' | 'parent_notification'
  data: any
  timestamp: number
  studentId?: string
}

interface CacheStatus {
  static: number
  api: number
  students: number
  content: number
  total: number
}

interface SyncStatus {
  isSync: boolean
  lastSync: Date | null
  queuedActions: number
  syncedCount: number
  failedCount: number
}

export function useOffline() {
  // État de connexion
  const isOnline = ref(navigator.onLine)
  const isServiceWorkerReady = ref(false)
  
  // État synchronisation
  const syncStatus = ref<SyncStatus>({
    isSync: false,
    lastSync: null,
    queuedActions: 0,
    syncedCount: 0,
    failedCount: 0
  })
  
  // Cache status
  const cacheStatus = ref<CacheStatus>({
    static: 0,
    api: 0,
    students: 0,
    content: 0,
    total: 0
  })
  
  const { showNotification } = useNotification()
  
  // ===== COMPUTED =====
  
  const canUseOffline = computed(() => 
    isServiceWorkerReady.value && 'serviceWorker' in navigator
  )
  
  const hasQueuedActions = computed(() => 
    syncStatus.value.queuedActions > 0
  )
  
  const lastSyncText = computed(() => {
    if (!syncStatus.value.lastSync) return 'Jamais synchronisé'
    
    const now = new Date()
    const diff = now.getTime() - syncStatus.value.lastSync.getTime()
    
    if (diff < 60000) return 'À l\'instant'
    if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)} min`
    if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`
    
    return syncStatus.value.lastSync.toLocaleDateString('fr-FR')
  })
  
  // ===== MÉTHODES PRINCIPALES =====
  
  /**
   * Initialisation du service offline
   */
  async function initializeOffline() {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.register('/sw.js')
        console.log('✅ Service Worker enregistré')
        
        // Attendre que le SW soit prêt
        await navigator.serviceWorker.ready
        isServiceWorkerReady.value = true
        
        // Écouter les messages du SW
        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
        
        // Status initial
        await updateCacheStatus()
        
        showNotification({
          type: 'success',
          title: 'Mode offline activé',
          message: 'Vous pouvez maintenant utiliser l\'application hors ligne'
        })
        
      } else {
        console.warn('Service Worker non supporté')
      }
    } catch (error) {
      console.error('❌ Erreur initialisation offline:', error)
      showNotification({
        type: 'error',
        title: 'Mode offline indisponible',
        message: 'Impossible d\'activer le mode hors ligne'
      })
    }
  }
  
  /**
   * Ajouter une action à la queue offline
   */
  async function queueOfflineAction(
    type: OfflineAction['type'],
    data: any,
    studentId?: string
  ) {
    if (!canUseOffline.value) {
      throw new Error('Mode offline non disponible')
    }
    
    const action = {
      type,
      data,
      studentId
    }
    
    // Envoyer au Service Worker
    await sendToServiceWorker('QUEUE_OFFLINE_ACTION', action)
    
    // Mettre à jour le status
    syncStatus.value.queuedActions++
    
    showNotification({
      type: 'info',
      title: 'Action sauvée hors ligne',
      message: 'Sera synchronisée à la prochaine connexion'
    })
    
    console.log('📥 Action mise en queue:', type)
  }
  
  /**
   * Synchroniser manuellement
   */
  async function syncNow() {
    if (!isOnline.value) {
      showNotification({
        type: 'warning',
        title: 'Synchronisation impossible',
        message: 'Aucune connexion internet'
      })
      return
    }
    
    if (syncStatus.value.isSync) {
      return // Déjà en cours
    }
    
    syncStatus.value.isSync = true
    
    try {
      await sendToServiceWorker('SYNC_WHEN_ONLINE')
      
      showNotification({
        type: 'info',
        title: 'Synchronisation en cours...',
        message: 'Vos données sont en cours de synchronisation'
      })
      
    } catch (error) {
      console.error('❌ Erreur synchronisation:', error)
      syncStatus.value.isSync = false
      
      showNotification({
        type: 'error',
        title: 'Synchronisation échouée',
        message: 'Erreur lors de la synchronisation'
      })
    }
  }
  
  /**
   * Vider le cache
   */
  async function clearCache() {
    if (!canUseOffline.value) return
    
    try {
      await sendToServiceWorker('CLEAR_CACHE')
      await updateCacheStatus()
      
      showNotification({
        type: 'success',
        title: 'Cache vidé',
        message: 'Toutes les données en cache ont été supprimées'
      })
      
    } catch (error) {
      console.error('❌ Erreur vidage cache:', error)
      showNotification({
        type: 'error',
        title: 'Erreur',
        message: 'Impossible de vider le cache'
      })
    }
  }
  
  /**
   * Obtenir les données en cache pour un élève
   */
  async function getCachedStudentData(studentId: string) {
    try {
      const response = await fetch(`/api/students/${studentId}`, {
        headers: {
          'Cache-Control': 'only-if-cached'
        }
      })
      
      if (response.ok) {
        return await response.json()
      }
      
      return null
    } catch (error) {
      console.log('Aucune donnée cache pour élève:', studentId)
      return null
    }
  }
  
  // ===== MÉTHODES UTILITAIRES =====
  
  /**
   * Communication avec le Service Worker
   */
  async function sendToServiceWorker(type: string, data?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!navigator.serviceWorker.controller) {
        reject(new Error('Service Worker non disponible'))
        return
      }
      
      const channel = new MessageChannel()
      
      channel.port1.onmessage = (event) => {
        resolve(event.data)
      }
      
      navigator.serviceWorker.controller.postMessage(
        { type, data },
        [channel.port2]
      )
    })
  }
  
  /**
   * Gestion des messages du Service Worker
   */
  function handleServiceWorkerMessage(event: MessageEvent) {
    const { type, data } = event.data
    
    switch (type) {
      case 'SYNC_COMPLETE':
        syncStatus.value.isSync = false
        syncStatus.value.lastSync = new Date()
        syncStatus.value.syncedCount = data.syncedCount
        syncStatus.value.failedCount = data.failedCount
        syncStatus.value.queuedActions = Math.max(0, syncStatus.value.queuedActions - data.syncedCount)
        
        if (data.syncedCount > 0) {
          showNotification({
            type: 'success',
            title: 'Synchronisation terminée',
            message: `${data.syncedCount} actions synchronisées`
          })
        }
        
        if (data.failedCount > 0) {
          showNotification({
            type: 'warning',
            title: 'Synchronisation partielle',
            message: `${data.failedCount} actions ont échoué`
          })
        }
        break
    }
  }
  
  /**
   * Mise à jour du status du cache
   */
  async function updateCacheStatus() {
    if (!canUseOffline.value) return
    
    try {
      const status = await sendToServiceWorker('GET_CACHE_STATUS')
      cacheStatus.value = status
    } catch (error) {
      console.error('❌ Erreur status cache:', error)
    }
  }
  
  /**
   * Gestionnaires d'événements réseau
   */
  function handleOnline() {
    isOnline.value = true
    
    showNotification({
      type: 'success',
      title: 'Connexion rétablie',
      message: 'Synchronisation automatique en cours...'
    })
    
    // Auto-sync quand on revient online
    if (hasQueuedActions.value) {
      syncNow()
    }
  }
  
  function handleOffline() {
    isOnline.value = false
    
    showNotification({
      type: 'info',
      title: 'Mode hors ligne',
      message: 'Vos actions seront synchronisées au retour de la connexion',
      persistent: true
    })
  }
  
  // ===== LIFECYCLE =====
  
  onMounted(() => {
    // Écoute des changements de connexion
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    // Initialisation
    initializeOffline()
  })
  
  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage)
    }
  })
  
  // ===== RETURN =====
  
  return {
    // État
    isOnline,
    isServiceWorkerReady,
    canUseOffline,
    syncStatus,
    cacheStatus,
    hasQueuedActions,
    lastSyncText,
    
    // Méthodes
    queueOfflineAction,
    syncNow,
    clearCache,
    getCachedStudentData,
    updateCacheStatus,
    
    // Utilitaires
    initializeOffline
  }
}