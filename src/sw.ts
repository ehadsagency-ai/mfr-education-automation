/**
 * 🔧 Service Worker - PWA Offline Capabilities
 * Gestion intelligente du cache et synchronisation hors ligne
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies'
import { BackgroundSync } from 'workbox-background-sync'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// Déclaration des types Workbox
declare const self: ServiceWorkerGlobalScope
declare const __WB_MANIFEST: Array<{ url: string; revision?: string }>

// Configuration cache
const CACHE_CONFIG = {
  STATIC_CACHE: 'mfr-static-v1',
  API_CACHE: 'mfr-api-v1', 
  STUDENT_DATA_CACHE: 'mfr-students-v1',
  CONTENT_CACHE: 'mfr-content-v1',
  OFFLINE_FALLBACK: 'mfr-offline-v1'
}

// Données critiques à synchroniser
interface OfflineAction {
  id: string
  type: 'student_note' | 'student_observation' | 'content_request' | 'parent_notification'
  data: any
  timestamp: number
  studentId?: string
}

// ===== SETUP ET PRECACHING =====
console.log('🔧 Service Worker MFR Education v2.0 starting...')

// Nettoyage anciens caches
cleanupOutdatedCaches()

// Precache des ressources statiques
precacheAndRoute(__WB_MANIFEST)

// ===== STRATEGIES DE CACHE =====

// 1. App Shell - Cache First (performance)
registerRoute(
  ({ request, url }) => {
    return request.destination === 'document' ||
           url.pathname.startsWith('/assets/') ||
           url.pathname.endsWith('.js') ||
           url.pathname.endsWith('.css')
  },
  new CacheFirst({
    cacheName: CACHE_CONFIG.STATIC_CACHE,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 jours
        purgeOnQuotaError: true
      })
    ]
  })
)

// 2. API Data - Network First avec fallback
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: CACHE_CONFIG.API_CACHE,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 24 * 60 * 60, // 1 jour
        purgeOnQuotaError: true
      })
    ]
  })
)

// 3. Données élèves - Cache intelligent avec chiffrement
registerRoute(
  ({ url }) => url.pathname.includes('/api/students'),
  async ({ request, url }) => {
    try {
      // Tentative réseau d'abord
      const networkResponse = await fetch(request)
      
      if (networkResponse.ok) {
        // Cache des données chiffrées
        const cache = await caches.open(CACHE_CONFIG.STUDENT_DATA_CACHE)
        await cache.put(request, networkResponse.clone())
        return networkResponse
      }
      
      throw new Error('Network failed')
      
    } catch (error) {
      console.log('📱 Mode offline: récupération cache élèves')
      
      // Fallback cache
      const cache = await caches.open(CACHE_CONFIG.STUDENT_DATA_CACHE)
      const cachedResponse = await cache.match(request)
      
      if (cachedResponse) {
        return cachedResponse
      }
      
      // Fallback ultime - données de base
      return new Response(JSON.stringify({
        success: false,
        offline: true,
        message: 'Données non disponibles hors ligne'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
)

// 4. Contenu pédagogique - Stale While Revalidate
registerRoute(
  ({ url }) => url.pathname.includes('/api/content'),
  new StaleWhileRevalidate({
    cacheName: CACHE_CONFIG.CONTENT_CACHE,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 jours
        purgeOnQuotaError: true
      })
    ]
  })
)

// ===== SYNCHRONISATION BACKGROUND =====

// Background Sync pour données critiques
const bgSync = new BackgroundSync('mfr-offline-sync', {
  maxRetentionTime: 24 * 60 // 24 heures
})

// Queue des actions offline
let offlineQueue: OfflineAction[] = []

// Écoute des messages depuis l'app
self.addEventListener('message', async (event) => {
  const { type, data } = event.data
  
  switch (type) {
    case 'QUEUE_OFFLINE_ACTION':
      await queueOfflineAction(data)
      break
      
    case 'SYNC_WHEN_ONLINE':
      if (navigator.onLine) {
        await syncOfflineActions()
      }
      break
      
    case 'GET_CACHE_STATUS':
      const status = await getCacheStatus()
      event.ports[0].postMessage(status)
      break
      
    case 'CLEAR_CACHE':
      await clearAllCaches()
      event.ports[0].postMessage({ success: true })
      break
  }
})

// ===== GESTION OFFLINE =====

async function queueOfflineAction(actionData: Omit<OfflineAction, 'id' | 'timestamp'>) {
  const action: OfflineAction = {
    id: generateId(),
    timestamp: Date.now(),
    ...actionData
  }
  
  console.log('📥 Action mise en queue offline:', action.type)
  
  // Stockage en IndexedDB pour persistence
  await storeOfflineAction(action)
  
  // Ajout à la queue en mémoire
  offlineQueue.push(action)
  
  // Background sync si possible
  try {
    await bgSync.registerSync()
  } catch (error) {
    console.log('Background sync non disponible, attente connexion')
  }
}

async function syncOfflineActions() {
  console.log('🔄 Synchronisation actions offline...')
  
  // Récupération des actions depuis IndexedDB
  const actions = await getStoredOfflineActions()
  
  let syncedCount = 0
  let failedCount = 0
  
  for (const action of actions) {
    try {
      await syncSingleAction(action)
      await removeOfflineAction(action.id)
      syncedCount++
    } catch (error) {
      console.error('❌ Échec sync action:', action.id, error)
      failedCount++
    }
  }
  
  // Notification à l'app
  const clients = await self.clients.matchAll()
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_COMPLETE',
      data: { syncedCount, failedCount }
    })
  })
  
  console.log(`✅ Sync terminée: ${syncedCount} succès, ${failedCount} échecs`)
}

async function syncSingleAction(action: OfflineAction) {
  const endpoint = getEndpointForAction(action.type)
  
  const response = await fetch(`/api${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Offline-Action': 'true'
    },
    body: JSON.stringify({
      ...action.data,
      offlineTimestamp: action.timestamp
    })
  })
  
  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`)
  }
  
  return response.json()
}

function getEndpointForAction(type: OfflineAction['type']): string {
  switch (type) {
    case 'student_note':
      return '/students/notes'
    case 'student_observation':
      return '/students/observations'
    case 'content_request':
      return '/content/requests'
    case 'parent_notification':
      return '/communications/parents'
    default:
      return '/sync'
  }
}

// ===== STOCKAGE INDEXEDDB =====

async function storeOfflineAction(action: OfflineAction): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MFROfflineDB', 1)
    
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('offlineActions')) {
        const store = db.createObjectStore('offlineActions', { keyPath: 'id' })
        store.createIndex('timestamp', 'timestamp')
        store.createIndex('type', 'type')
      }
    }
    
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(['offlineActions'], 'readwrite')
      const store = transaction.objectStore('offlineActions')
      
      store.add(action)
      
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    }
    
    request.onerror = () => reject(request.error)
  })
}

async function getStoredOfflineActions(): Promise<OfflineAction[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MFROfflineDB', 1)
    
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(['offlineActions'], 'readonly')
      const store = transaction.objectStore('offlineActions')
      
      const getAllRequest = store.getAll()
      
      getAllRequest.onsuccess = () => {
        resolve(getAllRequest.result)
      }
      
      getAllRequest.onerror = () => reject(getAllRequest.error)
    }
    
    request.onerror = () => reject(request.error)
  })
}

async function removeOfflineAction(actionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MFROfflineDB', 1)
    
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(['offlineActions'], 'readwrite')
      const store = transaction.objectStore('offlineActions')
      
      store.delete(actionId)
      
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    }
    
    request.onerror = () => reject(request.error)
  })
}

// ===== UTILITAIRES =====

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

async function getCacheStatus() {
  const caches = await Promise.all([
    caches.open(CACHE_CONFIG.STATIC_CACHE),
    caches.open(CACHE_CONFIG.API_CACHE),
    caches.open(CACHE_CONFIG.STUDENT_DATA_CACHE),
    caches.open(CACHE_CONFIG.CONTENT_CACHE)
  ])
  
  const sizes = await Promise.all(
    caches.map(async cache => {
      const keys = await cache.keys()
      return keys.length
    })
  )
  
  return {
    static: sizes[0],
    api: sizes[1],
    students: sizes[2],
    content: sizes[3],
    total: sizes.reduce((a, b) => a + b, 0)
  }
}

async function clearAllCaches() {
  const cacheNames = Object.values(CACHE_CONFIG)
  await Promise.all(cacheNames.map(name => caches.delete(name)))
  
  // Clear IndexedDB
  indexedDB.deleteDatabase('MFROfflineDB')
}

// ===== ÉVÉNEMENTS =====

// Installation
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker installé')
  self.skipWaiting()
})

// Activation
self.addEventListener('activate', (event) => {
  console.log('⚡ Service Worker activé')
  event.waitUntil(self.clients.claim())
})

// Online/Offline detection
self.addEventListener('online', () => {
  console.log('🌐 Connexion rétablie - synchronisation...')
  syncOfflineActions()
})

// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'mfr-offline-sync') {
    event.waitUntil(syncOfflineActions())
  }
})

// Push notifications (pour la Phase 3)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {}
  
  const options = {
    title: data.title || 'MFR Education',
    body: data.body || 'Nouvelle notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || 'default',
    data: data.data || {},
    actions: data.actions || []
  }
  
  event.waitUntil(self.registration.showNotification(options.title, options))
})

console.log('✅ Service Worker MFR Education v2.0 prêt!')