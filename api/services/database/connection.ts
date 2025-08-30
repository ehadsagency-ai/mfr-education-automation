/**
 * 🗄️ MongoDB Atlas Connection Manager
 * Gestion optimisée de la connexion avec monitoring et résilience
 */

import { MongoClient, Db, MongoClientOptions } from 'mongodb'
import { Logger } from '../logging/logger'
import { MetricsCollector } from '../monitoring/metrics'
import { CircuitBreaker } from '../resilience/circuit-breaker'

interface ConnectionConfig {
  uri: string
  dbName: string
  options: MongoClientOptions
}

interface ConnectionHealth {
  isConnected: boolean
  latency: number
  serverStatus: any
  replicaSetStatus?: any
  lastCheck: Date
}

export class MongoConnection {
  private client: MongoClient | null = null
  private db: Db | null = null
  private logger = new Logger('MongoConnection')
  private metrics = new MetricsCollector()
  private circuitBreaker = new CircuitBreaker({
    threshold: 5,
    timeout: 30000,
    monitor: true
  })
  
  private config: ConnectionConfig
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  
  constructor() {
    this.config = {
      uri: process.env.MONGODB_URI!,
      dbName: process.env.MONGODB_DB_NAME || 'mfr_education',
      options: {
        // Connection Pool
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10'),
        minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '2'),
        maxIdleTimeMS: 30000,
        
        // Timeouts
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        
        // Retry Logic
        retryWrites: true,
        retryReads: true,
        
        // Monitoring
        monitorCommands: true,
        
        // Compression
        compressors: ['zstd', 'zlib'],
        zlibCompressionLevel: 6,
        
        // SSL/TLS
        ssl: true,
        authSource: 'admin',
        
        // Write Concern (pour cohérence ACID)
        writeConcern: {
          w: 'majority',
          j: true,
          wtimeout: 5000
        },
        
        // Read Preference
        readPreference: 'primaryPreferred',
        readConcern: { level: 'majority' },
        
        // App Name pour monitoring Atlas
        appName: 'MFR-Education-v2'
      }
    }
    
    this.validateConfig()
  }
  
  // ===== CONNECTION MANAGEMENT =====
  
  async connect(): Promise<void> {
    try {
      this.logger.info('🔌 Connexion à MongoDB Atlas...')
      
      await this.circuitBreaker.execute(async () => {
        // Création du client MongoDB
        this.client = new MongoClient(this.config.uri, this.config.options)
        
        // Connexion effective
        await this.client.connect()
        
        // Sélection de la base
        this.db = this.client.db(this.config.dbName)
        
        // Test de connectivité
        await this.db.admin().ping()
        
        this.logger.info('✅ MongoDB Atlas connecté avec succès')
        
        // Setup monitoring
        this.setupConnectionMonitoring()
        
        // Métriques
        await this.metrics.record('mongodb_connection_established', {
          dbName: this.config.dbName,
          poolSize: this.config.options.maxPoolSize
        })
        
        // Reset des tentatives de reconnexion
        this.reconnectAttempts = 0
      })
      
    } catch (error) {
      this.logger.error('❌ Erreur connexion MongoDB', { error })
      
      // Métriques d'erreur
      await this.metrics.record('mongodb_connection_failed', {
        error: error.message,
        attempts: this.reconnectAttempts
      })
      
      // Tentative de reconnexion
      await this.handleReconnection(error)
    }
  }
  
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close()
        this.client = null
        this.db = null
        this.logger.info('📴 MongoDB déconnecté')
      }
    } catch (error) {
      this.logger.error('❌ Erreur déconnexion MongoDB', { error })
    }
  }
  
  // ===== RECONNECTION LOGIC =====
  
  private async handleReconnection(error: Error): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Connexion MongoDB impossible après ${this.maxReconnectAttempts} tentatives: ${error.message}`)
    }
    
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    this.logger.warn(`🔄 Tentative de reconnexion ${this.reconnectAttempts}/${this.maxReconnectAttempts} dans ${delay}ms`)
    
    await new Promise(resolve => setTimeout(resolve, delay))
    return this.connect()
  }
  
  // ===== MONITORING =====
  
  private setupConnectionMonitoring(): void {
    if (!this.client) return
    
    // Monitoring des commandes
    this.client.on('commandStarted', (event) => {
      this.metrics.record('mongodb_command_started', {
        command: event.commandName,
        collection: event.command?.collection
      })
    })
    
    this.client.on('commandSucceeded', async (event) => {
      const duration = event.duration
      
      await this.metrics.record('mongodb_command_completed', {
        command: event.commandName,
        duration,
        success: true
      })
      
      // Alerte commandes lentes
      if (duration > 2000) {
        this.logger.warn('🐌 Requête MongoDB lente détectée', {
          command: event.commandName,
          duration,
          collection: event.reply?.collection
        })
        
        await this.metrics.record('mongodb_slow_query', {
          command: event.commandName,
          duration,
          threshold: 2000
        })
      }
    })
    
    this.client.on('commandFailed', async (event) => {
      this.logger.error('❌ Commande MongoDB échouée', {
        command: event.commandName,
        error: event.failure,
        duration: event.duration
      })
      
      await this.metrics.record('mongodb_command_failed', {
        command: event.commandName,
        error: event.failure.message,
        duration: event.duration
      })
    })
    
    // Monitoring de la connexion
    this.client.on('serverHeartbeatSucceeded', async (event) => {
      await this.metrics.record('mongodb_heartbeat', {
        duration: event.duration,
        server: event.connectionId
      })
    })
    
    this.client.on('serverHeartbeatFailed', async (event) => {
      this.logger.error('💔 Heartbeat MongoDB échoué', event)
      
      await this.metrics.record('mongodb_heartbeat_failed', {
        error: event.failure?.message,
        server: event.connectionId
      })
    })
  }
  
  // ===== HEALTH CHECK =====
  
  async getConnectionHealth(): Promise<ConnectionHealth> {
    const startTime = Date.now()
    
    try {
      if (!this.db) {
        throw new Error('Base de données non connectée')
      }
      
      // Ping pour latence
      await this.db.admin().ping()
      const latency = Date.now() - startTime
      
      // Status du serveur
      const serverStatus = await this.db.admin().serverStatus()
      
      // Status replica set si applicable
      let replicaSetStatus
      try {
        replicaSetStatus = await this.db.admin().replSetGetStatus()
      } catch {
        // Pas un replica set, ignore
      }
      
      return {
        isConnected: true,
        latency,
        serverStatus: {
          version: serverStatus.version,
          uptime: serverStatus.uptime,
          connections: serverStatus.connections,
          network: serverStatus.network,
          opcounters: serverStatus.opcounters
        },
        replicaSetStatus,
        lastCheck: new Date()
      }
      
    } catch (error) {
      return {
        isConnected: false,
        latency: Date.now() - startTime,
        serverStatus: null,
        lastCheck: new Date()
      }
    }
  }
  
  // ===== GETTERS =====
  
  getDatabase(): Db {
    if (!this.db) {
      throw new Error('Base de données non connectée. Appelez connect() d\'abord.')
    }
    return this.db
  }
  
  getClient(): MongoClient {
    if (!this.client) {
      throw new Error('Client MongoDB non initialisé')
    }
    return this.client
  }
  
  isConnected(): boolean {
    return this.client !== null && this.db !== null
  }
  
  // ===== VALIDATION =====
  
  private validateConfig(): void {
    if (!this.config.uri) {
      throw new Error('MONGODB_URI est requis')
    }
    
    if (!this.config.uri.includes('mongodb+srv://') && !this.config.uri.includes('mongodb://')) {
      throw new Error('Format MONGODB_URI invalide')
    }
    
    if (this.config.options.maxPoolSize! < 1) {
      throw new Error('maxPoolSize doit être >= 1')
    }
    
    this.logger.info('✅ Configuration MongoDB validée', {
      dbName: this.config.dbName,
      maxPoolSize: this.config.options.maxPoolSize,
      compression: this.config.options.compressors
    })
  }
  
  // ===== UTILS =====
  
  async withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      let lastError: Error
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await operation()
        } catch (error) {
          lastError = error as Error
          
          if (attempt === maxRetries) break
          
          const delay = 1000 * Math.pow(2, attempt - 1)
          this.logger.warn(`🔄 Tentative ${attempt}/${maxRetries} échouée, retry dans ${delay}ms`, {
            error: error.message
          })
          
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
      
      throw lastError!
    })
  }
}

// Singleton instance
export const mongoConnection = new MongoConnection()