import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useMediaQuery, useNetwork, useDevicePixelRatio, useBattery } from '@vueuse/core'

export interface PerformanceMetrics {
  firstPaint: number
  firstContentfulPaint: number
  largestContentfulPaint: number
  firstInputDelay: number
  cumulativeLayoutShift: number
  interactionToNextPaint: number
}

export interface MobileOptimizationConfig {
  enableImageLazyLoading: boolean
  enableComponentLazyLoading: boolean
  enableNetworkAdaptation: boolean
  enableBatteryOptimization: boolean
  enableReducedMotion: boolean
  enablePrefetching: boolean
}

/**
 * Composable pour l'optimisation des performances mobiles
 * Adapte automatiquement l'application selon les capacités du device
 */
export function useMobileOptimization(config?: Partial<MobileOptimizationConfig>) {
  const defaultConfig: MobileOptimizationConfig = {
    enableImageLazyLoading: true,
    enableComponentLazyLoading: true,
    enableNetworkAdaptation: true,
    enableBatteryOptimization: true,
    enableReducedMotion: true,
    enablePrefetching: true,
    ...config
  }

  // Détection des capacités du device
  const isMobile = useMediaQuery('(max-width: 768px)')
  const isTablet = useMediaQuery('(min-width: 769px) and (max-width: 1024px)')
  const isLowEndDevice = useMediaQuery('(max-width: 480px)')
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const devicePixelRatio = useDevicePixelRatio()
  const network = useNetwork()
  const battery = useBattery()

  // Métriques de performance
  const performanceMetrics = ref<Partial<PerformanceMetrics>>({})
  const isPerformanceMeasuring = ref(false)

  // États d'optimisation
  const isLowPowerMode = computed(() => {
    return battery.value.charging === false && (battery.value.level ?? 1) < 0.2
  })

  const isSlowConnection = computed(() => {
    const connectionType = (network.value as any)?.effectiveType
    return connectionType === '2g' || connectionType === 'slow-2g' || network.value.saveData
  })

  const shouldReduceAnimations = computed(() => {
    return prefersReducedMotion.value || 
           isLowPowerMode.value || 
           isSlowConnection.value ||
           isLowEndDevice.value
  })

  const shouldLazyLoadImages = computed(() => {
    return defaultConfig.enableImageLazyLoading && 
           (isMobile.value || isSlowConnection.value)
  })

  const shouldOptimizeForBattery = computed(() => {
    return defaultConfig.enableBatteryOptimization && 
           (isLowPowerMode.value || !battery.value.charging)
  })

  /**
   * Mesure les métriques de performance Web Vitals
   */
  const measurePerformanceMetrics = async (): Promise<void> => {
    if (!('performance' in window) || isPerformanceMeasuring.value) return

    isPerformanceMeasuring.value = true

    try {
      // First Paint (FP)
      const paintEntries = performance.getEntriesByType('paint')
      const fpEntry = paintEntries.find(entry => entry.name === 'first-paint')
      const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint')

      if (fpEntry) performanceMetrics.value.firstPaint = fpEntry.startTime
      if (fcpEntry) performanceMetrics.value.firstContentfulPaint = fcpEntry.startTime

      // Largest Contentful Paint (LCP)
      if ('PerformanceObserver' in window) {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const lastEntry = entries[entries.length - 1] as any
          if (lastEntry) {
            performanceMetrics.value.largestContentfulPaint = lastEntry.startTime
          }
        })
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })

        // First Input Delay (FID)
        const fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((entry: any) => {
            performanceMetrics.value.firstInputDelay = entry.processingStart - entry.startTime
          })
        })
        fidObserver.observe({ entryTypes: ['first-input'] })

        // Cumulative Layout Shift (CLS)
        let clsValue = 0
        const clsObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((entry: any) => {
            if (!entry.hadRecentInput) {
              clsValue += entry.value
            }
          })
          performanceMetrics.value.cumulativeLayoutShift = clsValue
        })
        clsObserver.observe({ entryTypes: ['layout-shift'] })
      }

      // Navigation Timing
      const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      if (navigationEntry) {
        // Calculer des métriques additionnelles si nécessaire
        const domContentLoaded = navigationEntry.domContentLoadedEventEnd - navigationEntry.domContentLoadedEventStart
        console.log('DOM Content Loaded:', domContentLoaded)
      }

    } catch (error) {
      console.warn('Performance measurement failed:', error)
    } finally {
      isPerformanceMeasuring.value = false
    }
  }

  /**
   * Optimise les images selon les capacités du device
   */
  const getOptimizedImageSrc = (src: string, width?: number, height?: number): string => {
    if (!shouldLazyLoadImages.value) return src

    const params = new URLSearchParams()
    
    // Ajuster la qualité selon le contexte
    if (isSlowConnection.value) {
      params.set('q', '60') // Qualité réduite pour connexions lentes
    } else if (shouldOptimizeForBattery.value) {
      params.set('q', '75') // Qualité optimisée pour la batterie
    } else {
      params.set('q', '85') // Qualité normale
    }

    // Ajuster les dimensions selon le device pixel ratio
    if (width) {
      const optimizedWidth = Math.ceil(width * (devicePixelRatio.value || 1))
      params.set('w', optimizedWidth.toString())
    }
    
    if (height) {
      const optimizedHeight = Math.ceil(height * (devicePixelRatio.value || 1))
      params.set('h', optimizedHeight.toString())
    }

    // Format optimisé
    if (isMobile.value) {
      params.set('f', 'webp') // Format WebP pour mobile
    }

    return `${src}?${params.toString()}`
  }

  /**
   * Précharge les ressources critiques de manière intelligente
   */
  const intelligentPrefetch = (resources: string[]): void => {
    if (!defaultConfig.enablePrefetching || isSlowConnection.value || isLowPowerMode.value) {
      return
    }

    resources.forEach(resource => {
      const link = document.createElement('link')
      link.rel = 'prefetch'
      link.href = resource
      link.as = resource.endsWith('.js') ? 'script' : 'fetch'
      document.head.appendChild(link)
    })
  }

  /**
   * Lazy loading intelligent pour les composants
   */
  const lazyLoadComponent = async (componentLoader: () => Promise<any>): Promise<any> => {
    if (!defaultConfig.enableComponentLazyLoading) {
      return componentLoader()
    }

    // Attendre que le thread principal soit disponible
    await nextTick()
    
    // Sur des devices lents, attendre un peu plus
    if (isLowEndDevice.value) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return componentLoader()
  }

  /**
   * Optimise les animations selon les capacités
   */
  const getAnimationConfig = () => {
    if (shouldReduceAnimations.value) {
      return {
        duration: 150,
        easing: 'ease-out',
        enabled: false
      }
    }

    if (isMobile.value) {
      return {
        duration: 250,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        enabled: true
      }
    }

    return {
      duration: 300,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      enabled: true
    }
  }

  /**
   * Gère l'intersection observer pour le lazy loading
   */
  const createIntersectionObserver = (
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ): IntersectionObserver | null => {
    if (!('IntersectionObserver' in window)) return null

    const defaultOptions: IntersectionObserverInit = {
      rootMargin: isMobile.value ? '50px' : '100px', // Marge plus petite sur mobile
      threshold: 0.1,
      ...options
    }

    return new IntersectionObserver(callback, defaultOptions)
  }

  /**
   * Détecte les gestes touch spécifiques au mobile
   */
  const setupTouchGestures = (element: HTMLElement, callbacks: {
    onSwipeLeft?: () => void
    onSwipeRight?: () => void
    onSwipeUp?: () => void
    onSwipeDown?: () => void
    onPinch?: (scale: number) => void
  }) => {
    if (!isMobile.value) return

    let touchStartX = 0
    let touchStartY = 0
    let touchStartDistance = 0

    element.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX
        touchStartY = e.touches[0].clientY
      } else if (e.touches.length === 2) {
        const distance = Math.sqrt(
          Math.pow(e.touches[1].clientX - e.touches[0].clientX, 2) +
          Math.pow(e.touches[1].clientY - e.touches[0].clientY, 2)
        )
        touchStartDistance = distance
      }
    }, { passive: true })

    element.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const touchEndX = e.changedTouches[0].clientX
        const touchEndY = e.changedTouches[0].clientY
        
        const deltaX = touchEndX - touchStartX
        const deltaY = touchEndY - touchStartY
        
        const minSwipeDistance = 50
        
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
          if (deltaX > 0) {
            callbacks.onSwipeRight?.()
          } else {
            callbacks.onSwipeLeft?.()
          }
        } else if (Math.abs(deltaY) > minSwipeDistance) {
          if (deltaY > 0) {
            callbacks.onSwipeDown?.()
          } else {
            callbacks.onSwipeUp?.()
          }
        }
      }
    }, { passive: true })

    element.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && touchStartDistance > 0) {
        const currentDistance = Math.sqrt(
          Math.pow(e.touches[1].clientX - e.touches[0].clientX, 2) +
          Math.pow(e.touches[1].clientY - e.touches[0].clientY, 2)
        )
        const scale = currentDistance / touchStartDistance
        callbacks.onPinch?.(scale)
      }
    }, { passive: true })
  }

  // Initialisation
  onMounted(() => {
    measurePerformanceMetrics()
    
    // Précharger les ressources critiques si approprié
    if (!isSlowConnection.value && !isLowPowerMode.value) {
      intelligentPrefetch([
        '/api/user/profile',
        '/api/courses/recent'
      ])
    }
  })

  onUnmounted(() => {
    // Cleanup si nécessaire
  })

  return {
    // États du device
    isMobile,
    isTablet,
    isLowEndDevice,
    devicePixelRatio,
    network,
    battery,

    // États d'optimisation
    isLowPowerMode,
    isSlowConnection,
    shouldReduceAnimations,
    shouldLazyLoadImages,
    shouldOptimizeForBattery,

    // Métriques
    performanceMetrics: readonly(performanceMetrics),
    isPerformanceMeasuring: readonly(isPerformanceMeasuring),

    // Méthodes utilitaires
    measurePerformanceMetrics,
    getOptimizedImageSrc,
    intelligentPrefetch,
    lazyLoadComponent,
    getAnimationConfig,
    createIntersectionObserver,
    setupTouchGestures
  }
}