import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, LoginCredentials, AuthTokens, Permission } from '@/types'
import { apiClient } from '@/services/api'
import { encryptionService } from '@/services/encryption'
import router from '@/router'

export const useAuthStore = defineStore('auth', () => {
  // État
  const user = ref<User | null>(null)
  const tokens = ref<AuthTokens | null>(null)
  const permissions = ref<Permission[]>([])
  const isInitialized = ref(false)
  
  // Getters
  const isAuthenticated = computed(() => !!user.value && !!tokens.value)
  const userRole = computed(() => user.value?.role)
  const userPermissions = computed(() => permissions.value.map(p => p.name))
  
  // Actions
  async function login(credentials: LoginCredentials): Promise<void> {
    try {
      // Appel API de connexion
      const response = await apiClient.post<{
        user: User
        tokens: AuthTokens
        permissions: Permission[]
      }>('/api/auth/login', credentials)
      
      const { user: userData, tokens: authTokens, permissions: userPerms } = response
      
      // Stockage sécurisé
      await setUserData(userData, authTokens, userPerms)
      
      // Configuration API avec token
      apiClient.setAuthToken(authTokens.accessToken)
      
      // Audit de connexion
      await logSecurityEvent('user_login', {
        userId: userData.id,
        method: 'password',
        success: true
      })
      
    } catch (error) {
      // Audit tentative de connexion échouée
      await logSecurityEvent('user_login_failed', {
        email: credentials.email,
        error: error.message
      })
      throw error
    }
  }
  
  async function loginWithSSO(provider: 'google' | 'microsoft'): Promise<void> {
    try {
      // Redirection vers le provider SSO
      const authUrl = await apiClient.get<{ url: string }>(`/api/auth/${provider}`)
      window.location.href = authUrl.url
      
    } catch (error) {
      console.error(`Erreur SSO ${provider}:`, error)
      throw error
    }
  }
  
  async function handleSSOCallback(code: string, state: string): Promise<void> {
    try {
      const response = await apiClient.post<{
        user: User
        tokens: AuthTokens  
        permissions: Permission[]
      }>('/api/auth/sso/callback', { code, state })
      
      const { user: userData, tokens: authTokens, permissions: userPerms } = response
      await setUserData(userData, authTokens, userPerms)
      
      apiClient.setAuthToken(authTokens.accessToken)
      
      await logSecurityEvent('user_sso_login', {
        userId: userData.id,
        provider: 'google', // À adapter selon le provider
        success: true
      })
      
    } catch (error) {
      await logSecurityEvent('user_sso_login_failed', { error: error.message })
      throw error
    }
  }
  
  async function logout(): Promise<void> {
    try {
      if (tokens.value) {
        // Invalidation côté serveur
        await apiClient.post('/api/auth/logout', {
          refreshToken: tokens.value.refreshToken
        })
      }
      
      // Audit de déconnexion
      await logSecurityEvent('user_logout', {
        userId: user.value?.id,
        success: true
      })
      
    } catch (error) {
      console.error('Erreur logout:', error)
    } finally {
      // Nettoyage local
      await clearUserData()
      
      // Redirection vers login
      router.push({ name: 'login' })
    }
  }
  
  async function refreshToken(): Promise<boolean> {
    try {
      if (!tokens.value?.refreshToken) {
        return false
      }
      
      const response = await apiClient.post<{ tokens: AuthTokens }>('/api/auth/refresh', {
        refreshToken: tokens.value.refreshToken
      })
      
      tokens.value = response.tokens
      await encryptionService.secureStore('auth_tokens', tokens.value)
      
      apiClient.setAuthToken(response.tokens.accessToken)
      
      return true
      
    } catch (error) {
      console.error('Erreur refresh token:', error)
      await logout()
      return false
    }
  }
  
  async function initializeAuth(): Promise<void> {
    try {
      // Récupération des données chiffrées
      const storedUser = await encryptionService.secureRetrieve('user_data')
      const storedTokens = await encryptionService.secureRetrieve('auth_tokens')
      const storedPermissions = await encryptionService.secureRetrieve('user_permissions')
      
      if (storedUser && storedTokens) {
        user.value = storedUser
        tokens.value = storedTokens
        permissions.value = storedPermissions || []
        
        // Vérification validité token
        if (isTokenExpired(storedTokens.accessToken)) {
          const refreshSuccess = await refreshToken()
          if (!refreshSuccess) {
            await clearUserData()
            return
          }
        }
        
        // Configuration API
        apiClient.setAuthToken(tokens.value!.accessToken)
      }
      
    } catch (error) {
      console.error('Erreur initialisation auth:', error)
      await clearUserData()
    } finally {
      isInitialized.value = true
    }
  }
  
  function hasPermission(permissionName: string): boolean {
    return userPermissions.value.includes(permissionName) || user.value?.role === 'admin'
  }
  
  function hasAnyPermission(permissionNames: string[]): boolean {
    return permissionNames.some(name => hasPermission(name))
  }
  
  function hasRole(roleName: string): boolean {
    return user.value?.role === roleName
  }
  
  async function updateProfile(profileData: Partial<User>): Promise<void> {
    try {
      const updatedUser = await apiClient.put<User>('/api/auth/profile', profileData)
      
      user.value = { ...user.value!, ...updatedUser }
      await encryptionService.secureStore('user_data', user.value)
      
      await logSecurityEvent('user_profile_updated', {
        userId: user.value.id,
        updatedFields: Object.keys(profileData)
      })
      
    } catch (error) {
      console.error('Erreur mise à jour profil:', error)
      throw error
    }
  }
  
  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    try {
      await apiClient.post('/api/auth/change-password', {
        oldPassword,
        newPassword
      })
      
      await logSecurityEvent('user_password_changed', {
        userId: user.value?.id,
        success: true
      })
      
    } catch (error) {
      await logSecurityEvent('user_password_change_failed', {
        userId: user.value?.id,
        error: error.message
      })
      throw error
    }
  }
  
  // Helpers privés
  async function setUserData(userData: User, authTokens: AuthTokens, userPerms: Permission[]): Promise<void> {
    user.value = userData
    tokens.value = authTokens
    permissions.value = userPerms
    
    // Stockage chiffré
    await Promise.all([
      encryptionService.secureStore('user_data', userData),
      encryptionService.secureStore('auth_tokens', authTokens),
      encryptionService.secureStore('user_permissions', userPerms)
    ])
  }
  
  async function clearUserData(): Promise<void> {
    user.value = null
    tokens.value = null
    permissions.value = []
    
    // Nettoyage stockage
    await Promise.all([
      encryptionService.secureRemove('user_data'),
      encryptionService.secureRemove('auth_tokens'),
      encryptionService.secureRemove('user_permissions')
    ])
    
    apiClient.clearAuthToken()
  }
  
  function isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const now = Math.floor(Date.now() / 1000)
      return payload.exp < now
    } catch {
      return true
    }
  }
  
  async function logSecurityEvent(event: string, data: any): Promise<void> {
    try {
      await apiClient.post('/api/audit/security', {
        event,
        data,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        ipAddress: 'client_side' // Sera résolu côté serveur
      })
    } catch (error) {
      console.error('Erreur log audit:', error)
    }
  }
  
  return {
    // État
    user,
    isAuthenticated,
    isInitialized,
    userRole,
    userPermissions,
    
    // Actions
    login,
    loginWithSSO,
    handleSSOCallback,
    logout,
    refreshToken,
    initializeAuth,
    hasPermission,
    hasAnyPermission,
    hasRole,
    updateProfile,
    changePassword
  }
})