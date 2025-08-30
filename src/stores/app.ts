import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Notification, APIConfig } from '@/types'
import { apiClient } from '@/services/api'

export const useAppStore = defineStore('app', () => {
  // État
  const isLoading = ref(false)
  const notifications = ref<Notification[]>([])
  const sidebarOpen = ref(true)
  const apiConfig = ref<APIConfig | null>(null)
  
  // Compteurs
  const loadingCounter = ref(0)
  
  // Getters
  const hasNotifications = computed(() => notifications.value.length > 0)
  const unreadNotifications = computed(() => 
    notifications.value.filter(n => !n.read).length
  )
  const criticalNotifications = computed(() =>
    notifications.value.filter(n => n.type === 'error' || n.type === 'warning')
  )
  
  // Actions
  function setLoading(loading: boolean) {
    if (loading) {
      loadingCounter.value++
    } else {
      loadingCounter.value = Math.max(0, loadingCounter.value - 1)
    }
    isLoading.value = loadingCounter.value > 0
  }
  
  function addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) {
    const newNotification: Notification = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      read: false,
      ...notification
    }
    
    notifications.value.unshift(newNotification)
    
    // Auto-remove non-persistent notifications after 5s
    if (!notification.persistent) {
      setTimeout(() => {
        removeNotification(newNotification.id)
      }, 5000)
    }
    
    // Log critical notifications
    if (notification.type === 'error') {
      console.error('Critical notification:', notification)
    }
  }
  
  function removeNotification(id: string) {
    const index = notifications.value.findIndex(n => n.id === id)
    if (index > -1) {
      notifications.value.splice(index, 1)
    }
  }
  
  function markNotificationAsRead(id: string) {
    const notification = notifications.value.find(n => n.id === id)
    if (notification) {
      notification.read = true
    }
  }
  
  function clearNotifications() {
    notifications.value = []
  }
  
  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }
  
  function setSidebarOpen(open: boolean) {
    sidebarOpen.value = open
  }
  
  async function initializeAPI() {
    try {
      // Configuration de l'API client
      await apiClient.initialize()
      
      // Récupération de la configuration
      const config = await apiClient.get<APIConfig>('/api/config')
      apiConfig.value = config
      
      // Setup des interceptors
      setupAPIInterceptors()
      
    } catch (error) {
      console.error('Erreur initialisation API:', error)
      throw error
    }
  }
  
  function setupAPIInterceptors() {
    // Request interceptor
    apiClient.addRequestInterceptor((config) => {
      setLoading(true)
      return config
    })
    
    // Response interceptor
    apiClient.addResponseInterceptor(
      (response) => {
        setLoading(false)
        return response
      },
      (error) => {
        setLoading(false)
        
        // Gestion des erreurs globales
        if (error.response?.status === 401) {
          addNotification({
            type: 'error',
            title: 'Session expirée',
            message: 'Votre session a expiré. Veuillez vous reconnecter.',
            persistent: true
          })
        } else if (error.response?.status === 403) {
          addNotification({
            type: 'error', 
            title: 'Accès refusé',
            message: 'Vous n\'avez pas les permissions nécessaires.'
          })
        } else if (error.response?.status >= 500) {
          addNotification({
            type: 'error',
            title: 'Erreur serveur',
            message: 'Une erreur technique est survenue. Veuillez réessayer.'
          })
        } else if (!navigator.onLine) {
          addNotification({
            type: 'warning',
            title: 'Hors ligne',
            message: 'Vous êtes hors ligne. Certaines fonctionnalités ne sont pas disponibles.'
          })
        }
        
        return Promise.reject(error)
      }
    )
  }
  
  // Success helper
  function showSuccess(title: string, message?: string) {
    addNotification({
      type: 'success',
      title,
      message
    })
  }
  
  // Error helper
  function showError(title: string, message?: string, persistent = false) {
    addNotification({
      type: 'error',
      title,
      message,
      persistent
    })
  }
  
  // Warning helper
  function showWarning(title: string, message?: string) {
    addNotification({
      type: 'warning',
      title,
      message
    })
  }
  
  // Info helper
  function showInfo(title: string, message?: string) {
    addNotification({
      type: 'info',
      title,
      message
    })
  }
  
  return {
    // État
    isLoading,
    notifications,
    sidebarOpen,
    apiConfig,
    
    // Getters
    hasNotifications,
    unreadNotifications,
    criticalNotifications,
    
    // Actions
    setLoading,
    addNotification,
    removeNotification,
    markNotificationAsRead,
    clearNotifications,
    toggleSidebar,
    setSidebarOpen,
    initializeAPI,
    showSuccess,
    showError,
    showWarning,
    showInfo
  }
})