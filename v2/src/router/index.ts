import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

// Lazy loading des vues
const HomePage = () => import('@/views/HomePage.vue')
const LoginPage = () => import('@/views/auth/LoginPage.vue')
const DashboardPage = () => import('@/views/dashboard/DashboardPage.vue')
const StudentsPage = () => import('@/views/students/StudentsPage.vue')
const StudentDetailPage = () => import('@/views/students/StudentDetailPage.vue')
const ContentGenerationPage = () => import('@/views/content/ContentGenerationPage.vue')
const AnalyticsPage = () => import('@/views/analytics/AnalyticsPage.vue')
const SettingsPage = () => import('@/views/settings/SettingsPage.vue')
const NotFoundPage = () => import('@/views/NotFoundPage.vue')

// Définition des routes
const routes: RouteRecordRaw[] = [
  // Route d'accueil
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: {
      title: 'Accueil',
      requiresAuth: false,
      transition: 'fade'
    }
  },
  
  // Routes d'authentification
  {
    path: '/login',
    name: 'login',
    component: LoginPage,
    meta: {
      title: 'Connexion',
      layout: 'auth',
      requiresAuth: false,
      transition: 'slide'
    }
  },
  
  // Routes protégées
  {
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardPage,
    meta: {
      title: 'Tableau de bord',
      requiresAuth: true,
      permission: 'dashboard:read',
      transition: 'fade'
    }
  },
  
  // Gestion des élèves
  {
    path: '/students',
    name: 'students',
    component: StudentsPage,
    meta: {
      title: 'Élèves',
      requiresAuth: true,
      permission: 'students:read',
      transition: 'fade'
    }
  },
  {
    path: '/students/:id',
    name: 'student-detail',
    component: StudentDetailPage,
    props: true,
    meta: {
      title: 'Détail élève',
      requiresAuth: true,
      permission: 'students:read',
      transition: 'slide'
    }
  },
  
  // Génération de contenu IA
  {
    path: '/content',
    name: 'content-generation',
    component: ContentGenerationPage,
    meta: {
      title: 'Génération de contenu',
      requiresAuth: true,
      permission: 'content:create',
      transition: 'fade'
    }
  },
  
  // Analytics et rapports
  {
    path: '/analytics',
    name: 'analytics',
    component: AnalyticsPage,
    meta: {
      title: 'Analytics',
      requiresAuth: true,
      permission: 'analytics:read',
      transition: 'fade'
    }
  },
  
  // Paramètres
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage,
    meta: {
      title: 'Paramètres',
      requiresAuth: true,
      permission: 'settings:read',
      transition: 'fade'
    }
  },
  
  // Gestion des erreurs
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundPage,
    meta: {
      title: 'Page non trouvée',
      requiresAuth: false,
      transition: 'fade'
    }
  }
]

// Création du router
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }
    if (to.hash) {
      return { el: to.hash, behavior: 'smooth' }
    }
    return { top: 0, behavior: 'smooth' }
  }
})

// Guards de navigation
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  const appStore = useAppStore()
  
  try {
    // Mise à jour du titre de la page
    if (to.meta.title) {
      document.title = `${to.meta.title} | MFR Education`
    }
    
    // Loading state
    appStore.setLoading(true)
    
    // Vérification de l'authentification
    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      // Redirection vers login avec return URL
      next({
        name: 'login',
        query: { redirect: to.fullPath }
      })
      return
    }
    
    // Vérification des permissions
    if (to.meta.permission && !authStore.hasPermission(to.meta.permission as string)) {
      appStore.addNotification({
        type: 'error',
        title: 'Accès refusé',
        message: 'Vous n\'avez pas les permissions nécessaires pour accéder à cette page.'
      })
      next({ name: 'dashboard' })
      return
    }
    
    // Si utilisateur connecté tente d'accéder à login
    if (to.name === 'login' && authStore.isAuthenticated) {
      next({ name: 'dashboard' })
      return
    }
    
    next()
    
  } catch (error) {
    console.error('Erreur navigation:', error)
    appStore.addNotification({
      type: 'error',
      title: 'Erreur de navigation',
      message: 'Une erreur est survenue lors du chargement de la page.'
    })
    next({ name: 'home' })
  }
})

router.afterEach((to, from) => {
  const appStore = useAppStore()
  
  // Arrêt du loading
  appStore.setLoading(false)
  
  // Analytics de navigation (en production)
  if (import.meta.env.PROD && window.gtag) {
    window.gtag('config', 'GA_MEASUREMENT_ID', {
      page_title: to.meta.title,
      page_location: window.location.href,
      page_path: to.path
    })
  }
  
  // Log audit pour pages sensibles
  if (to.meta.permission) {
    console.log(`Navigation vers page protégée: ${to.name}`)
    // TODO: Envoyer événement audit au backend
  }
})

// Gestion des erreurs de navigation
router.onError((error) => {
  console.error('Erreur router:', error)
  const appStore = useAppStore()
  
  appStore.addNotification({
    type: 'error',
    title: 'Erreur de navigation',
    message: 'Impossible de charger la page demandée. Veuillez réessayer.'
  })
})

// Types pour l'extension des métadonnées de route
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    layout?: 'default' | 'auth'
    requiresAuth?: boolean
    permission?: string
    transition?: 'fade' | 'slide'
  }
}

export default router