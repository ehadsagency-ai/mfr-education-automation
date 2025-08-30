<template>
  <div 
    ref="imageContainer"
    :class="containerClasses"
    :style="containerStyles"
  >
    <img
      v-if="shouldLoad || isVisible"
      ref="imageElement"
      :src="optimizedSrc"
      :alt="alt"
      :width="width"
      :height="height"
      :loading="loading"
      :class="imageClasses"
      :style="imageStyles"
      @load="onImageLoad"
      @error="onImageError"
    >
    
    <!-- Placeholder pendant le chargement -->
    <div 
      v-if="!imageLoaded && (shouldLoad || isVisible)"
      :class="placeholderClasses"
      :style="placeholderStyles"
    >
      <div v-if="showSpinner" class="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full mx-auto"></div>
      <div v-else-if="placeholder" class="text-gray-400 text-sm text-center">{{ placeholder }}</div>
    </div>

    <!-- Image d'erreur -->
    <div
      v-if="imageError"
      :class="errorClasses"
      :style="errorStyles"
    >
      <div class="text-red-400 text-sm text-center">
        <svg class="w-8 h-8 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd" />
        </svg>
        {{ errorMessage || 'Erreur de chargement' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useMobileOptimization } from '@/composables/useMobileOptimization'

interface Props {
  src: string
  alt: string
  width?: number | string
  height?: number | string
  loading?: 'lazy' | 'eager'
  placeholder?: string
  showSpinner?: boolean
  errorMessage?: string
  lazy?: boolean
  containerClass?: string | string[]
  imageClass?: string | string[]
  placeholderClass?: string | string[]
  errorClass?: string | string[]
}

const props = withDefaults(defineProps<Props>(), {
  loading: 'lazy',
  showSpinner: true,
  lazy: true,
  containerClass: '',
  imageClass: '',
  placeholderClass: '',
  errorClass: ''
})

const emit = defineEmits<{
  load: [event: Event]
  error: [event: Event]
  visible: [entry: IntersectionObserverEntry]
}>()

// Composable pour l'optimisation mobile
const { 
  getOptimizedImageSrc, 
  shouldLazyLoadImages, 
  createIntersectionObserver,
  isSlowConnection,
  shouldOptimizeForBattery
} = useMobileOptimization()

// Refs
const imageContainer = ref<HTMLElement>()
const imageElement = ref<HTMLImageElement>()
const observer = ref<IntersectionObserver | null>(null)

// États
const isVisible = ref(false)
const shouldLoad = ref(!props.lazy)
const imageLoaded = ref(false)
const imageError = ref(false)

// Image source optimisée
const optimizedSrc = computed(() => {
  if (!props.src) return ''
  
  const numWidth = typeof props.width === 'string' ? parseInt(props.width) : props.width
  const numHeight = typeof props.height === 'string' ? parseInt(props.height) : props.height
  
  return getOptimizedImageSrc(props.src, numWidth, numHeight)
})

// Classes CSS calculées
const containerClasses = computed(() => {
  const classes = ['relative', 'overflow-hidden']
  
  if (typeof props.containerClass === 'string') {
    classes.push(...props.containerClass.split(' ').filter(Boolean))
  } else if (Array.isArray(props.containerClass)) {
    classes.push(...props.containerClass)
  }
  
  return classes.join(' ')
})

const imageClasses = computed(() => {
  const classes = ['transition-opacity', 'duration-300']
  
  if (!imageLoaded.value && !imageError.value) {
    classes.push('opacity-0')
  } else {
    classes.push('opacity-100')
  }
  
  if (typeof props.imageClass === 'string') {
    classes.push(...props.imageClass.split(' ').filter(Boolean))
  } else if (Array.isArray(props.imageClass)) {
    classes.push(...props.imageClass)
  }
  
  return classes.join(' ')
})

const placeholderClasses = computed(() => {
  const classes = [
    'absolute', 'inset-0', 'flex', 'items-center', 'justify-center',
    'bg-gray-100', 'dark:bg-gray-800'
  ]
  
  if (typeof props.placeholderClass === 'string') {
    classes.push(...props.placeholderClass.split(' ').filter(Boolean))
  } else if (Array.isArray(props.placeholderClass)) {
    classes.push(...props.placeholderClass)
  }
  
  return classes.join(' ')
})

const errorClasses = computed(() => {
  const classes = [
    'absolute', 'inset-0', 'flex', 'items-center', 'justify-center',
    'bg-gray-50', 'dark:bg-gray-900'
  ]
  
  if (typeof props.errorClass === 'string') {
    classes.push(...props.errorClass.split(' ').filter(Boolean))
  } else if (Array.isArray(props.errorClass)) {
    classes.push(...props.errorClass)
  }
  
  return classes.join(' ')
})

// Styles inline
const containerStyles = computed(() => {
  const styles: Record<string, string> = {}
  
  if (props.width) {
    styles.width = typeof props.width === 'number' ? `${props.width}px` : props.width
  }
  
  if (props.height) {
    styles.height = typeof props.height === 'number' ? `${props.height}px` : props.height
  }
  
  return styles
})

const imageStyles = computed(() => {
  const styles: Record<string, string> = {}
  
  // Optimisations pour les performances
  if (shouldOptimizeForBattery.value || isSlowConnection.value) {
    styles['image-rendering'] = 'optimizeSpeed'
  }
  
  return styles
})

const placeholderStyles = computed(() => {
  const styles: Record<string, string> = {}
  
  if (props.width && props.height) {
    // Maintenir le ratio d'aspect
    styles.aspectRatio = `${props.width} / ${props.height}`
  }
  
  return styles
})

const errorStyles = computed(() => placeholderStyles.value)

// Gestionnaires d'événements
const onImageLoad = (event: Event) => {
  imageLoaded.value = true
  imageError.value = false
  emit('load', event)
}

const onImageError = (event: Event) => {
  imageError.value = true
  imageLoaded.value = false
  emit('error', event)
}

const onIntersection = (entries: IntersectionObserverEntry[]) => {
  const entry = entries[0]
  
  if (entry.isIntersecting) {
    isVisible.value = true
    shouldLoad.value = true
    emit('visible', entry)
    
    // Arrêter l'observation une fois visible
    if (observer.value) {
      observer.value.disconnect()
    }
  }
}

// Configuration de l'intersection observer
const setupIntersectionObserver = () => {
  if (!props.lazy || !imageContainer.value) return
  
  observer.value = createIntersectionObserver(onIntersection, {
    rootMargin: shouldLazyLoadImages.value ? '50px' : '200px'
  })
  
  if (observer.value) {
    observer.value.observe(imageContainer.value)
  }
}

// Watchers
watch(() => props.src, () => {
  imageLoaded.value = false
  imageError.value = false
  
  if (!props.lazy) {
    shouldLoad.value = true
  }
})

// Lifecycle
onMounted(() => {
  if (props.lazy && shouldLazyLoadImages.value) {
    setupIntersectionObserver()
  } else {
    shouldLoad.value = true
  }
})

onUnmounted(() => {
  if (observer.value) {
    observer.value.disconnect()
  }
})
</script>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .transition-opacity {
    transition: none !important;
  }
}

/* Optimisations pour les écrans haute densité */
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 2dppx) {
  img {
    image-rendering: -webkit-optimize-contrast;
    image-rendering: optimize-contrast;
  }
}

/* Optimisations pour les connexions lentes */
@media (max-width: 480px) {
  img {
    image-rendering: optimizeSpeed;
  }
}
</style>