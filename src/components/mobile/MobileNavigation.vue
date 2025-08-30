<template>
  <div class="mobile-navigation">
    <!-- Bottom Navigation Bar -->
    <nav 
      v-if="isMobile"
      class="mobile-nav-bar"
      :class="{ 'nav-hidden': isNavHidden }"
    >
      <div class="nav-container">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          :class="['nav-item', { active: isActive(item.path) }]"
          @click="navigateTo(item)"
          @touchstart="onTouchStart"
        >
          <div class="nav-icon">
            <component :is="item.icon" class="w-6 h-6" />
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </div>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </div>
    </nav>

    <!-- Swipe Indicator -->
    <div 
      v-if="showSwipeIndicator && isMobile"
      class="swipe-indicator"
      @click="hideSwipeIndicator"
    >
      <div class="swipe-hint">
        <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 12l-4-4 1.41-1.41L10 9.17l2.59-2.58L14 8l-4 4z"/>
        </svg>
        <span>Glissez pour naviguer</span>
      </div>
    </div>

    <!-- Floating Action Button -->
    <transition name="fab">
      <button
        v-if="showFab && isMobile"
        class="floating-action-button"
        :class="{ 'fab-expanded': fabExpanded }"
        @click="toggleFab"
        @touchstart="onFabTouchStart"
      >
        <div class="fab-icon">
          <PlusIcon v-if="!fabExpanded" class="w-6 h-6" />
          <XMarkIcon v-else class="w-6 h-6" />
        </div>
        
        <transition name="fab-menu">
          <div v-if="fabExpanded" class="fab-menu">
            <button
              v-for="action in fabActions"
              :key="action.id"
              class="fab-menu-item"
              @click="executeAction(action)"
            >
              <component :is="action.icon" class="w-5 h-5" />
              <span>{{ action.label }}</span>
            </button>
          </div>
        </transition>
      </button>
    </transition>

    <!-- Pull to Refresh -->
    <div
      v-if="enablePullToRefresh && isMobile"
      ref="pullToRefreshContainer"
      class="pull-to-refresh"
      :class="{ 'pull-active': pullToRefreshActive, 'pull-triggered': pullTriggered }"
    >
      <div class="pull-indicator">
        <div v-if="!pullTriggered" class="pull-arrow">↓</div>
        <div v-else class="pull-spinner">
          <div class="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
        </div>
      </div>
    </div>

    <!-- Mobile Menu Overlay -->
    <transition name="overlay">
      <div
        v-if="showMobileMenu"
        class="mobile-menu-overlay"
        @click="closeMobileMenu"
      >
        <div class="mobile-menu" @click.stop>
          <div class="menu-header">
            <h3 class="menu-title">Menu</h3>
            <button class="menu-close" @click="closeMobileMenu">
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          
          <div class="menu-content">
            <div
              v-for="section in menuSections"
              :key="section.title"
              class="menu-section"
            >
              <h4 class="section-title">{{ section.title }}</h4>
              <div class="section-items">
                <button
                  v-for="item in section.items"
                  :key="item.id"
                  class="menu-item"
                  @click="executeMenuItem(item)"
                >
                  <component :is="item.icon" class="w-5 h-5" />
                  <span>{{ item.label }}</span>
                  <span v-if="item.shortcut" class="shortcut">{{ item.shortcut }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMobileOptimization } from '@/composables/useMobileOptimization'
import {
  HomeIcon,
  AcademicCapIcon,
  UserGroupIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  PlusIcon,
  XMarkIcon,
  DocumentPlusIcon,
  CameraIcon,
  ChatBubbleLeftIcon
} from '@heroicons/vue/24/outline'

interface NavigationItem {
  id: string
  label: string
  path: string
  icon: any
  badge?: number
}

interface FabAction {
  id: string
  label: string
  icon: any
  action: string
}

interface MenuItem {
  id: string
  label: string
  icon: any
  action: string
  shortcut?: string
}

interface MenuSection {
  title: string
  items: MenuItem[]
}

const props = defineProps<{
  enablePullToRefresh?: boolean
  showFab?: boolean
  showSwipeIndicator?: boolean
}>()

const emit = defineEmits<{
  navigate: [path: string]
  refresh: []
  action: [actionId: string]
  menuAction: [actionId: string]
}>()

// Router et composables
const router = useRouter()
const { 
  isMobile, 
  shouldReduceAnimations, 
  setupTouchGestures,
  getAnimationConfig
} = useMobileOptimization()

// Refs
const pullToRefreshContainer = ref<HTMLElement>()
const lastScrollY = ref(0)
const scrollDirection = ref<'up' | 'down'>('down')

// États
const isNavHidden = ref(false)
const showMobileMenu = ref(false)
const fabExpanded = ref(false)
const pullToRefreshActive = ref(false)
const pullTriggered = ref(false)
const showSwipeIndicator = ref(props.showSwipeIndicator ?? true)

// Navigation items
const navigationItems: NavigationItem[] = [
  {
    id: 'home',
    label: 'Accueil',
    path: '/',
    icon: HomeIcon
  },
  {
    id: 'courses',
    label: 'Cours',
    path: '/courses',
    icon: AcademicCapIcon,
    badge: 3
  },
  {
    id: 'students',
    label: 'Étudiants',
    path: '/students',
    icon: UserGroupIcon
  },
  {
    id: 'stats',
    label: 'Statistiques',
    path: '/statistics',
    icon: ChartBarIcon
  },
  {
    id: 'settings',
    label: 'Paramètres',
    path: '/settings',
    icon: Cog6ToothIcon
  }
]

// FAB Actions
const fabActions: FabAction[] = [
  {
    id: 'new-course',
    label: 'Nouveau cours',
    icon: DocumentPlusIcon,
    action: 'create-course'
  },
  {
    id: 'take-photo',
    label: 'Prendre une photo',
    icon: CameraIcon,
    action: 'camera'
  },
  {
    id: 'quick-message',
    label: 'Message rapide',
    icon: ChatBubbleLeftIcon,
    action: 'quick-message'
  }
]

// Menu sections
const menuSections: MenuSection[] = [
  {
    title: 'Actions',
    items: [
      {
        id: 'sync',
        label: 'Synchroniser',
        icon: HomeIcon,
        action: 'sync',
        shortcut: 'Ctrl+S'
      },
      {
        id: 'export',
        label: 'Exporter données',
        icon: DocumentPlusIcon,
        action: 'export'
      }
    ]
  },
  {
    title: 'Aide',
    items: [
      {
        id: 'help',
        label: 'Centre d\'aide',
        icon: ChatBubbleLeftIcon,
        action: 'help'
      },
      {
        id: 'feedback',
        label: 'Envoyer un feedback',
        icon: ChatBubbleLeftIcon,
        action: 'feedback'
      }
    ]
  }
]

// Computed
const isActive = computed(() => (path: string) => {
  return router.currentRoute.value.path === path
})

// Methods
const navigateTo = (item: NavigationItem) => {
  if (!shouldReduceAnimations.value) {
    // Animation de feedback tactile
    const button = event?.currentTarget as HTMLElement
    button?.classList.add('nav-pressed')
    setTimeout(() => button?.classList.remove('nav-pressed'), 150)
  }
  
  router.push(item.path)
  emit('navigate', item.path)
}

const executeAction = (action: FabAction) => {
  fabExpanded.value = false
  emit('action', action.action)
}

const executeMenuItem = (item: MenuItem) => {
  closeMobileMenu()
  emit('menuAction', item.action)
}

const toggleFab = () => {
  fabExpanded.value = !fabExpanded.value
}

const closeMobileMenu = () => {
  showMobileMenu.value = false
}

const hideSwipeIndicator = () => {
  showSwipeIndicator.value = false
}

// Touch handlers
const onTouchStart = (event: TouchEvent) => {
  if (!shouldReduceAnimations.value) {
    const button = event.currentTarget as HTMLElement
    button.style.transform = 'scale(0.95)'
    button.style.transition = 'transform 0.1s ease-out'
    
    setTimeout(() => {
      button.style.transform = ''
      button.style.transition = ''
    }, 100)
  }
}

const onFabTouchStart = (event: TouchEvent) => {
  if (!shouldReduceAnimations.value) {
    const fab = event.currentTarget as HTMLElement
    fab.style.transform = 'scale(0.9)'
    setTimeout(() => {
      fab.style.transform = ''
    }, 150)
  }
}

// Pull to refresh
const setupPullToRefresh = () => {
  if (!props.enablePullToRefresh || !pullToRefreshContainer.value) return

  let startY = 0
  let currentY = 0
  let pullDistance = 0
  const maxPullDistance = 100

  const onTouchStart = (e: TouchEvent) => {
    startY = e.touches[0].clientY
  }

  const onTouchMove = (e: TouchEvent) => {
    currentY = e.touches[0].clientY
    pullDistance = currentY - startY

    if (pullDistance > 0 && window.scrollY === 0) {
      e.preventDefault()
      pullToRefreshActive.value = true
      
      const progress = Math.min(pullDistance / maxPullDistance, 1)
      if (pullToRefreshContainer.value) {
        pullToRefreshContainer.value.style.transform = `translateY(${pullDistance * 0.5}px)`
        pullToRefreshContainer.value.style.opacity = progress.toString()
      }
    }
  }

  const onTouchEnd = () => {
    if (pullDistance > maxPullDistance) {
      pullTriggered.value = true
      emit('refresh')
      
      setTimeout(() => {
        pullTriggered.value = false
        pullToRefreshActive.value = false
        if (pullToRefreshContainer.value) {
          pullToRefreshContainer.value.style.transform = ''
          pullToRefreshContainer.value.style.opacity = ''
        }
      }, 2000)
    } else {
      pullToRefreshActive.value = false
      if (pullToRefreshContainer.value) {
        pullToRefreshContainer.value.style.transform = ''
        pullToRefreshContainer.value.style.opacity = ''
      }
    }
  }

  document.addEventListener('touchstart', onTouchStart, { passive: false })
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onTouchEnd)

  return () => {
    document.removeEventListener('touchstart', onTouchStart)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
  }
}

// Auto-hide navigation on scroll
const setupScrollHandler = () => {
  const handleScroll = () => {
    const currentScrollY = window.scrollY
    
    if (currentScrollY > lastScrollY.value && currentScrollY > 100) {
      scrollDirection.value = 'down'
      isNavHidden.value = true
    } else {
      scrollDirection.value = 'up'
      isNavHidden.value = false
    }
    
    lastScrollY.value = currentScrollY
  }

  window.addEventListener('scroll', handleScroll, { passive: true })
  
  return () => {
    window.removeEventListener('scroll', handleScroll)
  }
}

// Setup touch gestures
const setupMobileGestures = () => {
  if (!isMobile.value) return

  const body = document.body
  setupTouchGestures(body, {
    onSwipeLeft: () => {
      // Naviguer vers la page suivante
      const currentIndex = navigationItems.findIndex(item => isActive.value(item.path))
      const nextIndex = (currentIndex + 1) % navigationItems.length
      navigateTo(navigationItems[nextIndex])
    },
    onSwipeRight: () => {
      // Naviguer vers la page précédente
      const currentIndex = navigationItems.findIndex(item => isActive.value(item.path))
      const prevIndex = currentIndex === 0 ? navigationItems.length - 1 : currentIndex - 1
      navigateTo(navigationItems[prevIndex])
    },
    onSwipeDown: () => {
      if (window.scrollY === 0 && props.enablePullToRefresh) {
        emit('refresh')
      }
    }
  })
}

// Lifecycle
onMounted(() => {
  const cleanupHandlers: (() => void)[] = []
  
  if (isMobile.value) {
    const cleanupPullToRefresh = setupPullToRefresh()
    const cleanupScrollHandler = setupScrollHandler()
    
    if (cleanupPullToRefresh) cleanupHandlers.push(cleanupPullToRefresh)
    if (cleanupScrollHandler) cleanupHandlers.push(cleanupScrollHandler)
    
    setupMobileGestures()
    
    // Auto-hide swipe indicator after 5 seconds
    if (showSwipeIndicator.value) {
      setTimeout(() => {
        showSwipeIndicator.value = false
      }, 5000)
    }
  }

  onUnmounted(() => {
    cleanupHandlers.forEach(cleanup => cleanup())
  })
})
</script>

<style scoped>
.mobile-navigation {
  @apply relative;
}

.mobile-nav-bar {
  @apply fixed bottom-0 left-0 right-0 z-50;
  @apply bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700;
  @apply transition-transform duration-300 ease-in-out;
  padding-bottom: env(safe-area-inset-bottom);
}

.mobile-nav-bar.nav-hidden {
  @apply translate-y-full;
}

.nav-container {
  @apply flex justify-around items-center px-2 py-1;
}

.nav-item {
  @apply flex flex-col items-center justify-center;
  @apply px-3 py-2 rounded-lg transition-all duration-200;
  @apply text-gray-600 dark:text-gray-400;
  min-width: 60px;
}

.nav-item.active {
  @apply text-blue-600 dark:text-blue-400;
  @apply bg-blue-50 dark:bg-blue-900/30;
}

.nav-item:active {
  @apply scale-95;
}

.nav-icon {
  @apply relative mb-1;
}

.nav-badge {
  @apply absolute -top-1 -right-1;
  @apply bg-red-500 text-white text-xs;
  @apply rounded-full w-4 h-4 flex items-center justify-center;
  font-size: 10px;
}

.nav-label {
  @apply text-xs font-medium;
}

.floating-action-button {
  @apply fixed bottom-20 right-4 z-50;
  @apply w-14 h-14 bg-blue-600 text-white rounded-full;
  @apply shadow-lg hover:shadow-xl transition-all duration-300;
  @apply flex items-center justify-center;
}

.floating-action-button:active {
  @apply scale-90;
}

.fab-icon {
  @apply transition-transform duration-300;
}

.fab-expanded .fab-icon {
  @apply rotate-45;
}

.fab-menu {
  @apply absolute bottom-16 right-0;
  @apply flex flex-col space-y-2;
}

.fab-menu-item {
  @apply flex items-center space-x-2;
  @apply bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300;
  @apply px-4 py-2 rounded-full shadow-lg;
  @apply transition-all duration-200;
  @apply whitespace-nowrap;
}

.fab-menu-item:hover {
  @apply bg-gray-50 dark:bg-gray-700;
}

.pull-to-refresh {
  @apply fixed top-0 left-0 right-0 z-40;
  @apply flex items-center justify-center;
  @apply h-16 bg-white dark:bg-gray-900;
  @apply opacity-0 transform -translate-y-full;
  @apply transition-all duration-300;
}

.pull-to-refresh.pull-active {
  @apply opacity-100 translate-y-0;
}

.pull-indicator {
  @apply flex items-center justify-center;
}

.pull-arrow {
  @apply text-2xl text-gray-400 animate-bounce;
}

.swipe-indicator {
  @apply fixed bottom-24 left-1/2 transform -translate-x-1/2 z-40;
  @apply bg-black bg-opacity-75 text-white;
  @apply px-4 py-2 rounded-full;
  @apply flex items-center space-x-2;
  @apply text-sm;
  @apply animate-pulse;
}

.swipe-hint {
  @apply flex items-center space-x-2;
}

.mobile-menu-overlay {
  @apply fixed inset-0 z-50;
  @apply bg-black bg-opacity-50;
  @apply flex items-end;
}

.mobile-menu {
  @apply w-full max-h-96;
  @apply bg-white dark:bg-gray-900;
  @apply rounded-t-xl;
  @apply overflow-y-auto;
}

.menu-header {
  @apply flex items-center justify-between;
  @apply px-6 py-4 border-b border-gray-200 dark:border-gray-700;
}

.menu-title {
  @apply text-lg font-semibold;
}

.menu-close {
  @apply p-2 text-gray-500 hover:text-gray-700;
}

.menu-content {
  @apply px-6 py-4;
}

.menu-section {
  @apply mb-6 last:mb-0;
}

.section-title {
  @apply text-sm font-medium text-gray-500 dark:text-gray-400 mb-3;
}

.menu-item {
  @apply flex items-center justify-between;
  @apply w-full px-3 py-3 rounded-lg;
  @apply text-left hover:bg-gray-100 dark:hover:bg-gray-800;
  @apply transition-colors duration-200;
}

.shortcut {
  @apply text-xs text-gray-400 bg-gray-100 dark:bg-gray-700;
  @apply px-2 py-1 rounded;
}

/* Animations */
.fab-enter-active,
.fab-leave-active {
  transition: all 0.3s ease;
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0);
}

.fab-menu-enter-active,
.fab-menu-leave-active {
  transition: all 0.3s ease;
}

.fab-menu-enter-from,
.fab-menu-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.3s ease;
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}

.overlay-enter-active .mobile-menu,
.overlay-leave-active .mobile-menu {
  transition: transform 0.3s ease;
}

.overlay-enter-from .mobile-menu,
.overlay-leave-to .mobile-menu {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .mobile-nav-bar,
  .nav-item,
  .floating-action-button,
  .fab-menu-item {
    transition: none !important;
  }
  
  .animate-bounce,
  .animate-pulse,
  .animate-spin {
    animation: none !important;
  }
}
</style>