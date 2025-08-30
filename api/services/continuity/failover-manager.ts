import { MongoClient } from 'mongodb'
import { logger } from '../logging/logger'

export interface HealthCheckResult {
  service: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  responseTime: number
  lastCheck: Date
  details?: any
}

export interface FailoverConfig {
  primaryDatabase: string
  secondaryDatabase: string
  healthCheckInterval: number
  failoverThreshold: number
  autoFailback: boolean
}

/**
 * Gestionnaire de basculement et redondance système
 * Assure la haute disponibilité avec basculement automatique
 */
export class FailoverManager {
  private config: FailoverConfig
  private primaryClient: MongoClient
  private secondaryClient: MongoClient
  private currentPrimary: 'primary' | 'secondary' = 'primary'
  private healthChecks: Map<string, HealthCheckResult> = new Map()
  private failoverInProgress = false

  constructor(config?: Partial<FailoverConfig>) {
    this.config = {
      primaryDatabase: process.env.MONGODB_URI!,
      secondaryDatabase: process.env.MONGODB_SECONDARY_URI || process.env.MONGODB_URI!,
      healthCheckInterval: 30000, // 30 secondes
      failoverThreshold: 3, // 3 échecs consécutifs
      autoFailback: true,
      ...config
    }

    this.primaryClient = new MongoClient(this.config.primaryDatabase)
    this.secondaryClient = new MongoClient(this.config.secondaryDatabase)

    this.startHealthMonitoring()
  }

  /**
   * Démarre la surveillance de santé continue
   */
  private startHealthMonitoring(): void {
    setInterval(async () => {
      await this.performHealthChecks()
    }, this.config.healthCheckInterval)

    logger.info('Health monitoring started', {
      interval: this.config.healthCheckInterval,
      threshold: this.config.failoverThreshold
    })
  }

  /**
   * Effectue les vérifications de santé sur tous les services
   */
  async performHealthChecks(): Promise<Map<string, HealthCheckResult>> {
    const services = [
      { name: 'primary-database', client: this.primaryClient },
      { name: 'secondary-database', client: this.secondaryClient },
      { name: 'api-server', check: () => this.checkApiHealth() },
      { name: 'notification-service', check: () => this.checkNotificationHealth() }
    ]

    for (const service of services) {
      try {
        const startTime = Date.now()
        
        if (service.client) {
          await this.checkDatabaseHealth(service.client)
        } else if (service.check) {
          await service.check()
        }

        const responseTime = Date.now() - startTime
        
        this.healthChecks.set(service.name, {
          service: service.name,
          status: 'healthy',
          responseTime,
          lastCheck: new Date()
        })

      } catch (error) {
        this.healthChecks.set(service.name, {
          service: service.name,
          status: 'unhealthy',
          responseTime: -1,
          lastCheck: new Date(),
          details: error instanceof Error ? error.message : 'Unknown error'
        })

        logger.warn(`Health check failed for ${service.name}`, error)
      }
    }

    // Vérifier si un basculement est nécessaire
    await this.evaluateFailoverNeed()

    return this.healthChecks
  }

  /**
   * Vérifie la santé d'une base de données
   */
  private async checkDatabaseHealth(client: MongoClient): Promise<void> {
    await client.connect()
    const db = client.db()
    await db.admin().ping()
    await client.close()
  }

  /**
   * Vérifie la santé de l'API
   */
  private async checkApiHealth(): Promise<void> {
    // Simulation de vérification API
    if (process.env.NODE_ENV !== 'test') {
      const response = await fetch('http://localhost:3000/api/health')
      if (!response.ok) {
        throw new Error(`API health check failed: ${response.status}`)
      }
    }
  }

  /**
   * Vérifie la santé du service de notifications
   */
  private async checkNotificationHealth(): Promise<void> {
    // Vérification du service de notifications
    // Simulé pour l'exemple
    return Promise.resolve()
  }

  /**
   * Évalue si un basculement est nécessaire
   */
  private async evaluateFailoverNeed(): Promise<void> {
    if (this.failoverInProgress) return

    const primaryHealth = this.healthChecks.get('primary-database')
    const secondaryHealth = this.healthChecks.get('secondary-database')

    // Si la base principale est unhealthy et la secondaire healthy
    if (
      primaryHealth?.status === 'unhealthy' &&
      secondaryHealth?.status === 'healthy' &&
      this.currentPrimary === 'primary'
    ) {
      await this.performFailover('secondary')
    }

    // Auto-failback si configuré
    if (
      this.config.autoFailback &&
      this.currentPrimary === 'secondary' &&
      primaryHealth?.status === 'healthy' &&
      secondaryHealth?.status === 'healthy'
    ) {
      // Attendre un peu pour s'assurer de la stabilité
      setTimeout(async () => {
        await this.performFailover('primary')
      }, 60000) // 1 minute de délai
    }
  }

  /**
   * Effectue le basculement vers le système spécifié
   */
  async performFailover(target: 'primary' | 'secondary'): Promise<void> {
    if (this.failoverInProgress) {
      logger.warn('Failover already in progress')
      return
    }

    this.failoverInProgress = true
    const startTime = Date.now()

    try {
      logger.info(`Starting failover to ${target}`)

      // 1. Synchroniser les données si possible
      await this.synchronizeData(target)

      // 2. Rediriger le trafic
      await this.switchTraffic(target)

      // 3. Mettre à jour la configuration
      this.currentPrimary = target

      // 4. Notifier les services
      await this.notifyServicesOfFailover(target)

      const duration = Date.now() - startTime
      logger.info(`Failover to ${target} completed successfully in ${duration}ms`)

      // Log l'événement pour audit
      await this.logFailoverEvent(target, 'success', duration)

    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`Failover to ${target} failed`, error)
      
      await this.logFailoverEvent(target, 'failed', duration, error)
      throw error

    } finally {
      this.failoverInProgress = false
    }
  }

  /**
   * Synchronise les données entre les systèmes
   */
  private async synchronizeData(target: 'primary' | 'secondary'): Promise<void> {
    logger.info(`Synchronizing data for failover to ${target}`)

    try {
      const sourceClient = target === 'secondary' ? this.primaryClient : this.secondaryClient
      const targetClient = target === 'secondary' ? this.secondaryClient : this.primaryClient

      await sourceClient.connect()
      await targetClient.connect()

      const sourceDb = sourceClient.db()
      const targetDb = targetClient.db()

      // Synchroniser les collections critiques
      const criticalCollections = ['students', 'courses', 'users', 'rgpd_audit']

      for (const collectionName of criticalCollections) {
        const sourceCollection = sourceDb.collection(collectionName)
        const targetCollection = targetDb.collection(collectionName)

        // Obtenir les dernières modifications
        const cutoffTime = new Date(Date.now() - 5 * 60 * 1000) // 5 minutes
        
        const recentChanges = await sourceCollection.find({
          $or: [
            { updatedAt: { $gte: cutoffTime } },
            { createdAt: { $gte: cutoffTime } }
          ]
        }).toArray()

        if (recentChanges.length > 0) {
          // Upsert les changements récents
          for (const doc of recentChanges) {
            await targetCollection.replaceOne(
              { _id: doc._id },
              doc,
              { upsert: true }
            )
          }

          logger.info(`Synchronized ${recentChanges.length} recent changes for ${collectionName}`)
        }
      }

      await sourceClient.close()
      await targetClient.close()

    } catch (error) {
      logger.error('Data synchronization failed', error)
      throw error
    }
  }

  /**
   * Bascule le trafic vers le nouveau système
   */
  private async switchTraffic(target: 'primary' | 'secondary'): Promise<void> {
    // Dans un environnement réel, ceci impliquerait :
    // - Mise à jour des load balancers
    // - Modification des DNS
    // - Redirection des connexions actives
    
    logger.info(`Traffic switched to ${target} system`)
    
    // Simulation de la commutation
    if (process.env.NODE_ENV !== 'production') {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  /**
   * Notifie tous les services du basculement
   */
  private async notifyServicesOfFailover(target: 'primary' | 'secondary'): Promise<void> {
    const services = ['api-server', 'notification-service', 'export-service']
    
    for (const service of services) {
      try {
        // Dans un environnement réel, envoyer des notifications aux services
        logger.info(`Notifying ${service} of failover to ${target}`)
        
        // Simulation
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        logger.warn(`Failed to notify ${service} of failover`, error)
      }
    }
  }

  /**
   * Enregistre l'événement de basculement pour audit
   */
  private async logFailoverEvent(
    target: 'primary' | 'secondary',
    result: 'success' | 'failed',
    duration: number,
    error?: any
  ): Promise<void> {
    try {
      const client = target === 'primary' ? this.primaryClient : this.secondaryClient
      await client.connect()
      
      const failoverEvent = {
        timestamp: new Date(),
        type: 'failover',
        from: this.currentPrimary,
        to: target,
        result,
        duration,
        error: error ? (error instanceof Error ? error.message : String(error)) : undefined,
        healthChecks: Object.fromEntries(this.healthChecks)
      }

      await client.db().collection('system_events').insertOne(failoverEvent)
      await client.close()

    } catch (logError) {
      logger.error('Failed to log failover event', logError)
    }
  }

  /**
   * Obtient le statut actuel du système
   */
  getSystemStatus(): {
    currentPrimary: 'primary' | 'secondary'
    failoverInProgress: boolean
    healthChecks: HealthCheckResult[]
    lastHealthCheck: Date
  } {
    const healthCheckArray = Array.from(this.healthChecks.values())
    const lastHealthCheck = healthCheckArray.reduce((latest, check) => {
      return check.lastCheck > latest ? check.lastCheck : latest
    }, new Date(0))

    return {
      currentPrimary: this.currentPrimary,
      failoverInProgress: this.failoverInProgress,
      healthChecks: healthCheckArray,
      lastHealthCheck
    }
  }

  /**
   * Force un basculement manuel
   */
  async forceFailover(target: 'primary' | 'secondary'): Promise<void> {
    logger.info(`Manual failover requested to ${target}`)
    await this.performFailover(target)
  }

  /**
   * Arrête le gestionnaire de basculement
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down failover manager')
    
    try {
      await this.primaryClient.close()
      await this.secondaryClient.close()
    } catch (error) {
      logger.error('Error during failover manager shutdown', error)
    }
  }
}