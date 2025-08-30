<template>
  <div id="app" class="min-h-screen bg-gray-50">
    <!-- Navigation -->
    <AppNavbar v-if="!isAuthRoute" />
    
    <!-- Contenu principal -->
    <main class="transition-all duration-300" :class="{ 'ml-64': !isAuthRoute && !isMobile }">
      <div class="container mx-auto px-4 py-6">
        <!-- Notifications système -->
        <NotificationSystem />
        
        <!-- Loading global -->
        <LoadingScreen v-if="isLoading" />
        
        <!-- Router View avec transitions -->
        <RouterView v-slot="{ Component, route }">
          <Transition 
            :name="route.meta.transition || 'fade'"
            mode="out-in"
            appear
          >
            <Suspense>
              <component :is="Component" :key="route.path" />
              <template #fallback>
                <div class="flex items-center justify-center min-h-[400px]">
                  <LoadingSpinner size="lg" />
                </div>
              </template>
            </Suspense>
          </Transition>
        </RouterView>
      </div>
    </main>
    
    <!-- PWA Update Banner -->
    <PWAUpdateBanner />
    
    <!-- Offline Indicator -->
    <OfflineIndicator />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, provide } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useNetworkStore } from '@/stores/network'
import { useBreakpoints } from '@vueuse/core'

// Components
import AppNavbar from '@/components/layout/AppNavbar.vue'
import NotificationSystem from '@/components/ui/NotificationSystem.vue'
import LoadingScreen from '@/components/ui/LoadingScreen.vue'
import LoadingSpinner from '@/components/ui/LoadingSpinner.vue'
import PWAUpdateBanner from '@/components/pwa/PWAUpdateBanner.vue'
import OfflineIndicator from '@/components/pwa/OfflineIndicator.vue'

// Stores
const appStore = useAppStore()
const authStore = useAuthStore()
const networkStore = useNetworkStore()

// Router
const route = useRoute()

// Responsive breakpoints
const breakpoints = useBreakpoints({
  mobile: 768,
  desktop: 1024,
})
const isMobile = breakpoints.smaller('mobile')

// Computed
const isLoading = computed(() => appStore.isLoading)
const isAuthRoute = computed(() => route.meta.layout === 'auth')

// Provide/Inject pour les composants enfants
provide('isMobile', isMobile)
provide('appStore', appStore)

// Lifecycle
onMounted(async () => {
  // Initialisation de l'application
  try {
    appStore.setLoading(true)
    
    // Vérification de l'authentification
    await authStore.initializeAuth()
    
    // Initialisation du monitoring réseau
    networkStore.startNetworkMonitoring()
    
    // Configuration des interceptors API
    await appStore.initializeAPI()
    
  } catch (error) {
    console.error('Erreur initialisation app:', error)
    appStore.addNotification({
      type: 'error',
      title: 'Erreur d\'initialisation',
      message: 'Impossible de démarrer l\'application. Veuillez rafraîchir la page.',
      persistent: true
    })
  } finally {
    appStore.setLoading(false)
  }
})
</script>

<style scoped>
/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from {
  transform: translateX(100%);
}

.slide-leave-to {
  transform: translateX(-100%);
}

/* Animations loading */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>