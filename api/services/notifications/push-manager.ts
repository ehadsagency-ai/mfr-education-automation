/**
 * 📲 Push Notifications Manager
 * Système de notifications multi-canal avec préférences et analytics
 */

import webpush from 'web-push'
import { Logger } from '../logging/logger'
import { MetricsCollector } from '../monitoring/metrics'
import { mongoConnection } from '../database/connection'
import { EncryptionService } from '../security/encryption'
import type { 
  NotificationChannel, 
  NotificationPreferences, 
  NotificationTemplate,
  NotificationStats 
} from '@/types/notifications'

interface PushSubscription {
  userId: string
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  userAgent: string
  createdAt: Date
  lastUsed: Date
  active: boolean
}

interface NotificationPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  image?: string
  data?: Record<string, any>
  actions?: Array<{
    action: string
    title: string
    icon?: string
  }>
  requireInteraction?: boolean
  silent?: boolean
  tag?: string
  renotify?: boolean
  timestamp?: number
  vibrate?: number[]
}

interface DeliveryResult {
  channel: NotificationChannel
  success: boolean
  messageId?: string
  error?: string
  deliveredAt: Date
  latency: number
}

export class PushNotificationManager {
  private logger = new Logger('PushNotificationManager')
  private metrics = new MetricsCollector()
  private encryption = new EncryptionService()
  
  private subscriptionsCollection = mongoConnection.getDatabase().collection<PushSubscription>('push_subscriptions')
  private notificationsCollection = mongoConnection.getDatabase().collection('notifications_log')
  private preferencesCollection = mongoConnection.getDatabase().collection('notification_preferences')
  
  // Configuration VAPID pour Web Push
  private vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@mfr-education.fr'
  }
  
  // Templates de notifications prédéfinis
  private templates = new Map<string, NotificationTemplate>([
    ['student_at_risk', {
      id: 'student_at_risk',
      title: '⚠️ Élève en difficulté détecté',
      body: 'Un élève nécessite votre attention immédiate',
      icon: '/icons/alert.png',
      badge: '/icons/badge.png',
      requireInteraction: true,
      channels: ['push', 'email'],
      priority: 'high',
      actions: [
        { action: 'view_student', title: 'Voir l\'élève', icon: '/icons/view.png' },
        { action: 'schedule_meeting', title: 'Planifier RDV', icon: '/icons/calendar.png' }
      ]
    }],
    ['assignment_submitted', {
      id: 'assignment_submitted',
      title: '📝 Nouveau devoir soumis',
      body: 'Un élève a soumis un devoir à corriger',
      icon: '/icons/assignment.png',
      badge: '/icons/badge.png',
      channels: ['push'],
      priority: 'normal',
      actions: [
        { action: 'review_assignment', title: 'Corriger', icon: '/icons/edit.png' }
      ]
    }],
    ['parent_meeting_reminder', {
      id: 'parent_meeting_reminder',
      title: '📅 Rappel RDV parent',
      body: 'Réunion parent-professeur dans 1 heure',
      icon: '/icons/meeting.png',
      badge: '/icons/badge.png',
      requireInteraction: true,
      channels: ['push', 'email', 'sms'],
      priority: 'high',
      vibrate: [200, 100, 200]
    }],
    ['system_maintenance', {
      id: 'system_maintenance',
      title: '🔧 Maintenance système',
      body: 'Le système sera indisponible de 2h à 4h du matin',
      icon: '/icons/maintenance.png',
      badge: '/icons/badge.png',
      channels: ['push', 'email'],
      priority: 'low',
      silent: true
    }]
  ])
  
  constructor() {
    this.initializeWebPush()
    this.initializeCollections()
  }
  
  // ===== INITIALIZATION =====
  
  private initializeWebPush(): void {
    if (!this.vapidKeys.publicKey || !this.vapidKeys.privateKey) {
      throw new Error('Clés VAPID manquantes - configurez VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY')
    }
    
    webpush.setVapidDetails(
      this.vapidKeys.subject,
      this.vapidKeys.publicKey,
      this.vapidKeys.privateKey
    )
    
    this.logger.info('✅ Web Push initialisé avec clés VAPID')
  }
  
  private async initializeCollections(): Promise<void> {
    try {
      // Index pour les subscriptions
      await this.subscriptionsCollection.createIndex({ userId: 1 })
      await this.subscriptionsCollection.createIndex({ endpoint: 1 }, { unique: true })
      await this.subscriptionsCollection.createIndex({ active: 1, lastUsed: -1 })
      
      // Index pour les logs de notifications
      await this.notificationsCollection.createIndex({ userId: 1, createdAt: -1 })
      await this.notificationsCollection.createIndex({ templateId: 1 })
      await this.notificationsCollection.createIndex({ 
        createdAt: 1 
      }, { 
        expireAfterSeconds: 90 * 24 * 60 * 60 // 90 jours
      })
      
      this.logger.info('✅ Collections notifications initialisées')
    } catch (error) {
      this.logger.error('❌ Erreur initialisation collections', { error })
    }
  }
  
  // ===== SUBSCRIPTION MANAGEMENT =====
  
  async subscribe(
    userId: string, 
    subscription: webpush.PushSubscription,
    userAgent: string
  ): Promise<void> {
    try {
      const subscriptionDoc: PushSubscription = {
        userId,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        },
        userAgent,
        createdAt: new Date(),
        lastUsed: new Date(),
        active: true
      }
      
      await this.subscriptionsCollection.replaceOne(
        { endpoint: subscription.endpoint },
        subscriptionDoc,
        { upsert: true }
      )
      
      // Test notification de bienvenue
      await this.sendWelcomeNotification(userId)
      
      await this.metrics.record('push_subscription_created', {
        userId: await this.encryption.hashForAudit(userId)
      })
      
      this.logger.info('✅ Subscription push créée', { userId })
      
    } catch (error) {
      this.logger.error('❌ Erreur création subscription', { userId, error })
      throw error
    }
  }
  
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    try {
      await this.subscriptionsCollection.updateOne(
        { userId, endpoint },
        { $set: { active: false, unsubscribedAt: new Date() } }
      )
      
      await this.metrics.record('push_subscription_removed', {
        userId: await this.encryption.hashForAudit(userId)
      })
      
      this.logger.info('✅ Subscription push supprimée', { userId })
      
    } catch (error) {
      this.logger.error('❌ Erreur suppression subscription', { userId, error })
    }
  }
  
  // ===== NOTIFICATION SENDING =====
  
  async sendNotification(
    templateId: string,
    userId: string,
    data: Record<string, any> = {},
    options: {
      channels?: NotificationChannel[]
      priority?: 'low' | 'normal' | 'high' | 'critical'
      scheduledFor?: Date
      customPayload?: Partial<NotificationPayload>
    } = {}
  ): Promise<DeliveryResult[]> {
    const startTime = Date.now()
    
    try {
      // Récupération du template
      const template = this.templates.get(templateId)
      if (!template) {
        throw new Error(`Template de notification introuvable: ${templateId}`)
      }
      
      // Vérification des préférences utilisateur
      const preferences = await this.getUserPreferences(userId)
      const allowedChannels = this.filterChannelsByPreferences(
        options.channels || template.channels,
        preferences,
        options.priority || template.priority
      )
      
      if (allowedChannels.length === 0) {
        this.logger.info('🔇 Notification bloquée par préférences utilisateur', {
          userId,
          templateId
        })
        return []
      }
      
      // Personnalisation du payload
      const payload = await this.buildNotificationPayload(template, data, options.customPayload)
      
      // Envoi multi-canal
      const results: DeliveryResult[] = []
      
      for (const channel of allowedChannels) {
        try {
          const result = await this.sendToChannel(channel, userId, payload)
          results.push(result)
        } catch (channelError) {
          results.push({
            channel,
            success: false,
            error: channelError.message,
            deliveredAt: new Date(),
            latency: Date.now() - startTime
          })
        }
      }
      
      // Logging et métriques
      await this.logNotification(templateId, userId, payload, results)
      
      const successCount = results.filter(r => r.success).length
      await this.metrics.record('notification_sent', {
        templateId,
        userId: await this.encryption.hashForAudit(userId),
        channels: allowedChannels.length,
        successRate: successCount / results.length,
        totalLatency: Date.now() - startTime
      })
      
      this.logger.info('📲 Notification envoyée', {
        templateId,
        userId,
        channels: allowedChannels,
        success: `${successCount}/${results.length}`
      })
      
      return results
      
    } catch (error) {
      this.logger.error('❌ Erreur envoi notification', {
        templateId,
        userId,
        error
      })
      
      await this.metrics.record('notification_failed', {
        templateId,
        userId: await this.encryption.hashForAudit(userId),
        error: error.message
      })
      
      throw error
    }
  }
  
  // ===== CHANNEL IMPLEMENTATIONS =====
  
  private async sendToChannel(
    channel: NotificationChannel,
    userId: string,
    payload: NotificationPayload
  ): Promise<DeliveryResult> {
    const startTime = Date.now()
    
    switch (channel) {
      case 'push':
        return await this.sendPushNotification(userId, payload, startTime)
        
      case 'email':
        return await this.sendEmailNotification(userId, payload, startTime)
        
      case 'sms':
        return await this.sendSMSNotification(userId, payload, startTime)
        
      case 'in_app':
        return await this.sendInAppNotification(userId, payload, startTime)
        
      default:
        throw new Error(`Canal de notification non supporté: ${channel}`)
    }
  }
  
  private async sendPushNotification(
    userId: string,
    payload: NotificationPayload,
    startTime: number
  ): Promise<DeliveryResult> {
    try {
      // Récupération des subscriptions actives
      const subscriptions = await this.subscriptionsCollection
        .find({ userId, active: true })
        .toArray()
      
      if (subscriptions.length === 0) {
        throw new Error('Aucune subscription push active')
      }
      
      const pushPayload = {
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/icons/default.png',
        badge: payload.badge || '/icons/badge.png',
        image: payload.image,
        data: payload.data || {},
        actions: payload.actions || [],
        requireInteraction: payload.requireInteraction || false,
        silent: payload.silent || false,
        tag: payload.tag || `mfr-${Date.now()}`,
        renotify: payload.renotify || false,
        timestamp: payload.timestamp || Date.now(),
        vibrate: payload.vibrate
      }
      
      // Envoi à toutes les subscriptions
      const sendPromises = subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys
            },
            JSON.stringify(pushPayload),
            {
              TTL: 24 * 60 * 60, // 24 heures
              urgency: this.mapPriorityToUrgency(payload.data?.priority || 'normal')
            }
          )
          
          // Mise à jour lastUsed
          await this.subscriptionsCollection.updateOne(
            { _id: sub._id },
            { $set: { lastUsed: new Date() } }
          )
          
          return { success: true, endpoint: sub.endpoint }
          
        } catch (error) {
          // Gestion des subscriptions expirées/invalides
          if (error.statusCode === 410 || error.statusCode === 404) {
            await this.subscriptionsCollection.updateOne(
              { _id: sub._id },
              { $set: { active: false, error: 'Subscription expired' } }
            )
          }
          
          return { success: false, endpoint: sub.endpoint, error: error.message }
        }
      })
      
      const results = await Promise.allSettled(sendPromises)
      const successCount = results.filter(r => 
        r.status === 'fulfilled' && r.value.success
      ).length
      
      if (successCount === 0) {
        throw new Error('Aucune notification push délivrée')
      }
      
      return {
        channel: 'push',
        success: true,
        messageId: `push-${Date.now()}`,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
      
    } catch (error) {
      return {
        channel: 'push',
        success: false,
        error: error.message,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    }
  }
  
  private async sendEmailNotification(
    userId: string,
    payload: NotificationPayload,
    startTime: number
  ): Promise<DeliveryResult> {
    // Simulation d'envoi email - à implémenter avec service email réel
    try {
      await new Promise(resolve => setTimeout(resolve, 200))
      
      return {
        channel: 'email',
        success: true,
        messageId: `email-${Date.now()}`,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    } catch (error) {
      return {
        channel: 'email',
        success: false,
        error: error.message,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    }
  }
  
  private async sendSMSNotification(
    userId: string,
    payload: NotificationPayload,
    startTime: number
  ): Promise<DeliveryResult> {
    // Simulation d'envoi SMS - à implémenter avec service SMS réel
    try {
      await new Promise(resolve => setTimeout(resolve, 300))
      
      return {
        channel: 'sms',
        success: true,
        messageId: `sms-${Date.now()}`,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    } catch (error) {
      return {
        channel: 'sms',
        success: false,
        error: error.message,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    }
  }
  
  private async sendInAppNotification(
    userId: string,
    payload: NotificationPayload,
    startTime: number
  ): Promise<DeliveryResult> {
    // Stockage pour récupération par l'app
    try {
      await this.notificationsCollection.insertOne({
        userId,
        type: 'in_app',
        payload,
        read: false,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours
      })
      
      return {
        channel: 'in_app',
        success: true,
        messageId: `in-app-${Date.now()}`,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    } catch (error) {
      return {
        channel: 'in_app',
        success: false,
        error: error.message,
        deliveredAt: new Date(),
        latency: Date.now() - startTime
      }
    }
  }
  
  // ===== UTILITY FUNCTIONS =====
  
  private async buildNotificationPayload(
    template: NotificationTemplate,
    data: Record<string, any>,
    customPayload?: Partial<NotificationPayload>
  ): Promise<NotificationPayload> {
    // Interpolation des variables dans le template
    let title = template.title
    let body = template.body
    
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`
      title = title.replace(placeholder, String(value))
      body = body.replace(placeholder, String(value))
    }
    
    return {
      title,
      body,
      icon: template.icon,
      badge: template.badge,
      requireInteraction: template.requireInteraction,
      silent: template.silent,
      actions: template.actions,
      vibrate: template.vibrate,
      data: { ...data, templateId: template.id },
      ...customPayload
    }
  }
  
  private async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      const prefs = await this.preferencesCollection.findOne({ userId })
      
      if (!prefs) {
        // Préférences par défaut
        return {
          push: true,
          email: true,
          sms: false,
          in_app: true,
          frequency: 'immediate',
          quietHours: {
            enabled: true,
            start: '22:00',
            end: '07:00'
          },
          priorities: {
            critical: ['push', 'email', 'sms'],
            high: ['push', 'email'],
            normal: ['push'],
            low: ['in_app']
          }
        }
      }
      
      return prefs.preferences
    } catch (error) {
      this.logger.error('❌ Erreur récupération préférences', { userId, error })
      // Fallback sécurisé
      return {
        push: false,
        email: false,
        sms: false,
        in_app: true,
        frequency: 'daily',
        quietHours: { enabled: false, start: '22:00', end: '07:00' },
        priorities: {
          critical: ['in_app'],
          high: ['in_app'],
          normal: ['in_app'],
          low: ['in_app']
        }
      }
    }
  }
  
  private filterChannelsByPreferences(
    channels: NotificationChannel[],
    preferences: NotificationPreferences,
    priority: string
  ): NotificationChannel[] {
    // Filtrage basé sur les préférences de priorité
    const allowedByPriority = preferences.priorities[priority] || ['in_app']
    
    return channels.filter(channel => {
      // Vérification préférence générale
      if (!preferences[channel]) return false
      
      // Vérification priorité
      if (!allowedByPriority.includes(channel)) return false
      
      // Vérification heures silencieuses
      if (preferences.quietHours?.enabled && this.isQuietHour(preferences.quietHours)) {
        return channel === 'in_app' // Seules les notifications in-app pendant les heures silencieuses
      }
      
      return true
    })
  }
  
  private isQuietHour(quietHours: { start: string; end: string }): boolean {
    const now = new Date()
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    
    return currentTime >= quietHours.start || currentTime <= quietHours.end
  }
  
  private mapPriorityToUrgency(priority: string): webpush.Urgency {
    switch (priority) {
      case 'critical': return 'high'
      case 'high': return 'normal'
      case 'normal': return 'low'
      case 'low': return 'very-low'
      default: return 'normal'
    }
  }
  
  private async logNotification(
    templateId: string,
    userId: string,
    payload: NotificationPayload,
    results: DeliveryResult[]
  ): Promise<void> {
    try {
      await this.notificationsCollection.insertOne({
        templateId,
        userId: await this.encryption.hashForAudit(userId),
        payload: {
          title: payload.title,
          body: payload.body,
          // Ne pas logger les données sensibles
        },
        results: results.map(r => ({
          channel: r.channel,
          success: r.success,
          latency: r.latency,
          error: r.error
        })),
        createdAt: new Date(),
        successRate: results.filter(r => r.success).length / results.length
      })
    } catch (error) {
      this.logger.error('❌ Erreur logging notification', { error })
    }
  }
  
  private async sendWelcomeNotification(userId: string): Promise<void> {
    try {
      await this.sendNotification(
        'system_maintenance', // Template simple pour test
        userId,
        {
          title: '🎉 Notifications activées !',
          message: 'Vous recevrez maintenant les notifications importantes'
        },
        {
          channels: ['push'],
          priority: 'low'
        }
      )
    } catch (error) {
      this.logger.error('❌ Erreur notification bienvenue', { userId, error })
    }
  }
  
  // ===== ANALYTICS & STATS =====
  
  async getNotificationStats(
    userId?: string,
    timeframe: '24h' | '7d' | '30d' = '7d'
  ): Promise<NotificationStats> {
    try {
      const timeRange = this.getTimeRange(timeframe)
      const matchStage: any = {
        createdAt: { $gte: timeRange }
      }
      
      if (userId) {
        matchStage.userId = await this.encryption.hashForAudit(userId)
      }
      
      const stats = await this.notificationsCollection.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgSuccessRate: { $avg: '$successRate' },
            byTemplate: {
              $push: {
                template: '$templateId',
                success: '$successRate'
              }
            },
            byChannel: {
              $push: '$results'
            }
          }
        }
      ]).toArray()
      
      const result = stats[0] || {
        total: 0,
        avgSuccessRate: 0,
        byTemplate: [],
        byChannel: []
      }
      
      return {
        total: result.total,
        successRate: result.avgSuccessRate,
        templateStats: this.aggregateTemplateStats(result.byTemplate),
        channelStats: this.aggregateChannelStats(result.byChannel),
        timeframe
      }
      
    } catch (error) {
      this.logger.error('❌ Erreur stats notifications', { error })
      return {
        total: 0,
        successRate: 0,
        templateStats: {},
        channelStats: {},
        timeframe
      }
    }
  }
  
  private getTimeRange(timeframe: string): Date {
    const now = new Date()
    switch (timeframe) {
      case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000)
      case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      default: return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }
  }
  
  private aggregateTemplateStats(templateData: any[]): Record<string, number> {
    const stats = {}
    for (const item of templateData) {
      if (!stats[item.template]) {
        stats[item.template] = []
      }
      stats[item.template].push(item.success)
    }
    
    // Calcul moyenne par template
    for (const template of Object.keys(stats)) {
      const successes = stats[template]
      stats[template] = successes.reduce((a, b) => a + b, 0) / successes.length
    }
    
    return stats
  }
  
  private aggregateChannelStats(channelData: any[]): Record<string, number> {
    const stats = {}
    const flat = channelData.flat()
    
    for (const result of flat) {
      if (!stats[result.channel]) {
        stats[result.channel] = { total: 0, success: 0 }
      }
      stats[result.channel].total++
      if (result.success) {
        stats[result.channel].success++
      }
    }
    
    // Conversion en taux de succès
    for (const channel of Object.keys(stats)) {
      const data = stats[channel]
      stats[channel] = data.total > 0 ? data.success / data.total : 0
    }
    
    return stats
  }
}