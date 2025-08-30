import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from '@/router'
import App from '@/App.vue'

// Styles
import '@/assets/styles/main.css'

// PWA
import { registerSW } from 'virtual:pwa-register'

// Monitoring
import * as Sentry from '@sentry/vue'

const app = createApp(App)

// Configuration Sentry pour monitoring
if (import.meta.env.PROD) {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_ENVIRONMENT,
    integrations: [
      new Sentry.BrowserTracing({
        routingInstrumentation: Sentry.vueRouterInstrumentation(router),
      }),
    ],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  })
}

// Store Pinia
const pinia = createPinia()

// Plugins
app.use(pinia)
app.use(router)

// Configuration globale
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue Error:', err, info)
  if (import.meta.env.PROD) {
    Sentry.captureException(err, {
      contexts: {
        vue: {
          componentName: instance?.$options.name,
          info,
        },
      },
    })
  }
}

// Service Worker PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    onNeedRefresh() {
      // Notification à l'utilisateur qu'une mise à jour est disponible
      console.log('New version available, please refresh')
    },
    onOfflineReady() {
      console.log('App ready for offline use')
    },
  })
}

// Montage de l'application
app.mount('#app')

export { app }