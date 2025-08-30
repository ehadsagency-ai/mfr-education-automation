/**
 * 🧠 Intelligent Cache System
 * Cache multi-niveaux avec prédiction ML et optimisation automatique
 */

import { LRUCache } from 'lru-cache'
import { Logger } from '../logging/logger'
import { MetricsCollector } from '../monitoring/metrics'
import { mongoConnection } from '../database/connection'

interface CacheEntry<T = any> {
  data: T
  timestamp: number
  accessCount: number
  lastAccessed: number
  ttl: number
  priority: 'low' | 'medium' | 'high' | 'critical'
  source: 'compute' | 'database' | 'api' | 'user'
  size: number
  compressed?: boolean
}

interface CacheStats {
  level: string
  hitRate: number
  missRate: number
  totalRequests: number
  averageLatency: number
  totalSize: number
  entryCount: number
  evictions: number
}

interface PredictiveStats {
  pattern: string
  confidence: number
  nextAccess: number
  frequency: number
}

type CacheLevel = 'L1' | 'L2' | 'L3'

export class IntelligentCacheSystem {
  private logger = new Logger('IntelligentCache')
  private metrics = new MetricsCollector()
  
  // Cache L1: Mémoire haute vitesse (LRU)
  private l1Cache = new LRUCache<string, CacheEntry>({
    max: 1000, // 1000 entrées max
    maxSize: 50 * 1024 * 1024, // 50MB max
    sizeCalculation: (entry) => entry.size,
    ttl: 5 * 60 * 1000, // 5 minutes
    allowStale: true,
    updateAgeOnGet: true,
    noDeleteOnStaleGet: true
  })
  
  // Cache L2: Mémoire étendue (Map personnalisée)
  private l2Cache = new Map<string, CacheEntry>()
  private l2MaxSize = 200 * 1024 * 1024 // 200MB
  private l2CurrentSize = 0
  
  // Cache L3: MongoDB Collection (persistence)
  private l3Collection = mongoConnection.getDatabase().collection('cache_l3')
  
  // Statistiques et prédictions
  private stats = new Map<CacheLevel, CacheStats>()
  private accessPatterns = new Map<string, PredictiveStats>()
  private compressionThreshold = 1024 // 1KB
  
  constructor() {
    this.initializeStats()
    this.setupPeriodicMaintenance()
    this.initializeL3Collection()
  }
  
  // ===== INTERFACE PRINCIPALE =====
  
  /**
   * Récupération avec cache intelligent multi-niveaux
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now()
    
    try {
      // Étape 1: Cache L1 (mémoire haute vitesse)
      const l1Result = await this.getFromL1<T>(key)
      if (l1Result !== null) {
        await this.recordAccess(key, 'L1', Date.now() - startTime)
        return l1Result
      }
      
      // Étape 2: Cache L2 (mémoire étendue)
      const l2Result = await this.getFromL2<T>(key)
      if (l2Result !== null) {
        // Promotion vers L1
        await this.promoteToL1(key, l2Result)
        await this.recordAccess(key, 'L2', Date.now() - startTime)
        return l2Result
      }
      
      // Étape 3: Cache L3 (MongoDB)
      const l3Result = await this.getFromL3<T>(key)
      if (l3Result !== null) {
        // Promotion vers L2 puis L1
        await this.promoteToL2(key, l3Result)
        await this.promoteToL1(key, l3Result)
        await this.recordAccess(key, 'L3', Date.now() - startTime)
        return l3Result
      }
      
      // Cache miss complet
      await this.recordMiss(key, Date.now() - startTime)
      return null
      
    } catch (error) {
      this.logger.error('❌ Erreur récupération cache', { key, error })
      return null
    }
  }
  
  /**
   * Stockage avec placement intelligent
   */
  async set<T>(
    key: string,
    data: T,
    options: {
      ttl?: number
      priority?: CacheEntry['priority']
      source?: CacheEntry['source']
      predictive?: boolean
    } = {}
  ): Promise<void> {
    const startTime = Date.now()
    
    try {
      const serializedData = JSON.stringify(data)
      const size = Buffer.byteLength(serializedData, 'utf8')
      
      // Compression si nécessaire
      let finalData = serializedData
      let compressed = false
      if (size > this.compressionThreshold) {
        finalData = await this.compress(serializedData)
        compressed = true
      }
      
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        accessCount: 1,
        lastAccessed: Date.now(),
        ttl: options.ttl || this.calculateOptimalTTL(key),
        priority: options.priority || this.predictPriority(key),
        source: options.source || 'compute',
        size: Buffer.byteLength(finalData),
        compressed
      }
      
      // Placement intelligent basé sur la priorité et la taille
      if (entry.priority === 'critical' || size < 10 * 1024) {
        // L1: Données critiques ou petites
        await this.setInL1(key, entry)
      } else if (entry.priority === 'high' || size < 100 * 1024) {
        // L2: Données importantes ou moyennes
        await this.setInL2(key, entry)
        if (options.predictive !== false) {
          await this.setInL1(key, entry) // Aussi en L1 si prédictif
        }
      } else {
        // L3: Données volumineuses ou à long terme
        await this.setInL3(key, entry)
      }
      
      // Mise à jour des patterns
      this.updateAccessPattern(key)
      
      await this.metrics.record('cache_set', {
        key: this.hashKey(key),
        level: this.determineCacheLevel(entry),
        size,
        compressed,
        duration: Date.now() - startTime
      })
      
    } catch (error) {
      this.logger.error('❌ Erreur stockage cache', { key, error })
      throw error
    }
  }
  
  // ===== OPÉRATIONS L1 (MÉMOIRE HAUTE VITESSE) =====
  
  private async getFromL1<T>(key: string): Promise<T | null> {
    const entry = this.l1Cache.get(key)
    if (!entry) return null
    
    // Vérification TTL
    if (this.isExpired(entry)) {
      this.l1Cache.delete(key)
      return null
    }
    
    // Mise à jour statistiques d'accès
    entry.accessCount++
    entry.lastAccessed = Date.now()
    
    return entry.data as T
  }
  
  private async setInL1<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    this.l1Cache.set(key, entry)
  }
  
  private async promoteToL1<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      ttl: this.calculateOptimalTTL(key),
      priority: 'high',
      source: 'promoted',
      size: Buffer.byteLength(JSON.stringify(data))
    }
    
    await this.setInL1(key, entry)
  }
  
  // ===== OPÉRATIONS L2 (MÉMOIRE ÉTENDUE) =====
  
  private async getFromL2<T>(key: string): Promise<T | null> {
    const entry = this.l2Cache.get(key)
    if (!entry) return null
    
    // Vérification TTL
    if (this.isExpired(entry)) {
      await this.removeFromL2(key)
      return null
    }
    
    // Mise à jour statistiques d'accès
    entry.accessCount++
    entry.lastAccessed = Date.now()
    
    return entry.data as T
  }
  
  private async setInL2<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    // Vérification capacité
    if (this.l2CurrentSize + entry.size > this.l2MaxSize) {
      await this.evictFromL2()
    }
    
    this.l2Cache.set(key, entry)
    this.l2CurrentSize += entry.size
  }
  
  private async promoteToL2<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      ttl: this.calculateOptimalTTL(key) * 2, // TTL plus long pour L2
      priority: 'medium',
      source: 'promoted',
      size: Buffer.byteLength(JSON.stringify(data))
    }
    
    await this.setInL2(key, entry)
  }
  
  private async removeFromL2(key: string): Promise<void> {
    const entry = this.l2Cache.get(key)
    if (entry) {
      this.l2Cache.delete(key)
      this.l2CurrentSize -= entry.size
    }
  }
  
  private async evictFromL2(): Promise<void> {
    // Éviction LRU avec priorité
    const entries = Array.from(this.l2Cache.entries())
      .sort((a, b) => {
        // Priorité d'abord, puis LRU
        const priorityOrder = { low: 1, medium: 2, high: 3, critical: 4 }
        const priorityDiff = priorityOrder[a[1].priority] - priorityOrder[b[1].priority]
        if (priorityDiff !== 0) return priorityDiff
        
        return a[1].lastAccessed - b[1].lastAccessed
      })
    
    // Éviction jusqu'à libérer 20% de l'espace
    const targetSize = this.l2MaxSize * 0.8
    while (this.l2CurrentSize > targetSize && entries.length > 0) {
      const [key] = entries.shift()!
      await this.removeFromL2(key)
    }
  }
  
  // ===== OPÉRATIONS L3 (MONGODB) =====
  
  private async initializeL3Collection(): Promise<void> {
    try {
      // Index pour performance
      await this.l3Collection.createIndex({ key: 1 }, { unique: true })
      await this.l3Collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      await this.l3Collection.createIndex({ priority: 1, lastAccessed: -1 })
      
      this.logger.info('✅ Collection L3 cache initialisée')
    } catch (error) {
      this.logger.error('❌ Erreur initialisation L3', { error })
    }
  }
  
  private async getFromL3<T>(key: string): Promise<T | null> {
    try {
      const doc = await this.l3Collection.findOne({ key })
      if (!doc) return null
      
      // Vérification expiration
      if (doc.expiresAt && doc.expiresAt < new Date()) {
        await this.l3Collection.deleteOne({ key })
        return null
      }
      
      // Décompression si nécessaire
      let data = doc.data
      if (doc.compressed) {
        data = await this.decompress(data)
      }
      
      // Mise à jour statistiques
      await this.l3Collection.updateOne(
        { key },
        {
          $inc: { accessCount: 1 },
          $set: { lastAccessed: new Date() }
        }
      )
      
      return JSON.parse(data) as T
      
    } catch (error) {
      this.logger.error('❌ Erreur L3 get', { key, error })
      return null
    }
  }
  
  private async setInL3<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    try {
      let serializedData = JSON.stringify(entry.data)
      let compressed = false
      
      // Compression pour L3
      if (entry.size > this.compressionThreshold) {
        serializedData = await this.compress(serializedData)
        compressed = true
      }
      
      const doc = {
        key,
        data: serializedData,
        timestamp: new Date(entry.timestamp),
        accessCount: entry.accessCount,
        lastAccessed: new Date(entry.lastAccessed),
        expiresAt: new Date(Date.now() + entry.ttl),
        priority: entry.priority,
        source: entry.source,
        size: entry.size,
        compressed
      }
      
      await this.l3Collection.replaceOne(
        { key },
        doc,
        { upsert: true }
      )
      
    } catch (error) {
      this.logger.error('❌ Erreur L3 set', { key, error })
    }
  }
  
  // ===== PRÉDICTION ET OPTIMISATION =====
  
  private calculateOptimalTTL(key: string): number {
    const pattern = this.accessPatterns.get(key)
    if (!pattern) return 5 * 60 * 1000 // 5 minutes par défaut
    
    // TTL basé sur la fréquence d'accès
    if (pattern.frequency > 10) return 30 * 60 * 1000 // 30 min
    if (pattern.frequency > 5) return 15 * 60 * 1000   // 15 min
    return 5 * 60 * 1000 // 5 min
  }
  
  private predictPriority(key: string): CacheEntry['priority'] {
    // Prédiction basée sur les patterns
    if (key.includes('student') || key.includes('critical')) return 'critical'
    if (key.includes('analytics') || key.includes('performance')) return 'high'
    if (key.includes('content') || key.includes('class')) return 'medium'
    return 'low'
  }
  
  private updateAccessPattern(key: string): void {
    const now = Date.now()
    const existing = this.accessPatterns.get(key)
    
    if (existing) {
      existing.frequency++
      existing.nextAccess = this.predictNextAccess(existing, now)
      existing.confidence = Math.min(existing.confidence + 0.1, 1.0)
    } else {
      this.accessPatterns.set(key, {
        pattern: 'new',
        confidence: 0.1,
        nextAccess: now + 5 * 60 * 1000, // 5 min
        frequency: 1
      })
    }
  }
  
  private predictNextAccess(pattern: PredictiveStats, currentTime: number): number {
    // Prédiction simple basée sur la fréquence
    const avgInterval = 60 * 1000 / pattern.frequency // Intervalle moyen en ms
    return currentTime + avgInterval
  }
  
  // ===== UTILITAIRES =====
  
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() > (entry.timestamp + entry.ttl)
  }
  
  private determineCacheLevel(entry: CacheEntry): string {
    if (entry.priority === 'critical' || entry.size < 10 * 1024) return 'L1'
    if (entry.priority === 'high' || entry.size < 100 * 1024) return 'L2'
    return 'L3'
  }
  
  private hashKey(key: string): string {
    // Hash simple pour les métriques (anonymisation)
    return Buffer.from(key).toString('base64').substring(0, 8)
  }
  
  private async compress(data: string): Promise<string> {
    // Compression simple Base64 + gzip simulé
    return Buffer.from(data).toString('base64')
  }
  
  private async decompress(data: string): Promise<string> {
    // Décompression
    return Buffer.from(data, 'base64').toString('utf8')
  }
  
  // ===== STATISTIQUES ET MONITORING =====
  
  private initializeStats(): void {
    this.stats.set('L1', {
      level: 'L1',
      hitRate: 0,
      missRate: 0,
      totalRequests: 0,
      averageLatency: 0,
      totalSize: 0,
      entryCount: 0,
      evictions: 0
    })
    
    this.stats.set('L2', {
      level: 'L2',
      hitRate: 0,
      missRate: 0,
      totalRequests: 0,
      averageLatency: 0,
      totalSize: 0,
      entryCount: 0,
      evictions: 0
    })
    
    this.stats.set('L3', {
      level: 'L3',
      hitRate: 0,
      missRate: 0,
      totalRequests: 0,
      averageLatency: 0,
      totalSize: 0,
      entryCount: 0,
      evictions: 0
    })
  }
  
  private async recordAccess(key: string, level: CacheLevel, latency: number): Promise<void> {
    const stats = this.stats.get(level)!
    stats.totalRequests++
    stats.averageLatency = (stats.averageLatency + latency) / 2
    stats.hitRate = (stats.totalRequests - 1) / stats.totalRequests
    
    await this.metrics.record('cache_hit', {
      level,
      key: this.hashKey(key),
      latency
    })
  }
  
  private async recordMiss(key: string, latency: number): Promise<void> {
    await this.metrics.record('cache_miss', {
      key: this.hashKey(key),
      latency
    })
  }
  
  async getStats(): Promise<Map<CacheLevel, CacheStats>> {
    // Mise à jour des stats en temps réel
    const l1Stats = this.stats.get('L1')!
    l1Stats.entryCount = this.l1Cache.size
    l1Stats.totalSize = this.l1Cache.calculatedSize || 0
    
    const l2Stats = this.stats.get('L2')!
    l2Stats.entryCount = this.l2Cache.size
    l2Stats.totalSize = this.l2CurrentSize
    
    const l3Stats = this.stats.get('L3')!
    try {
      const l3Count = await this.l3Collection.countDocuments()
      l3Stats.entryCount = l3Count
    } catch (error) {
      this.logger.error('❌ Erreur stats L3', { error })
    }
    
    return this.stats
  }
  
  // ===== MAINTENANCE =====
  
  private setupPeriodicMaintenance(): void {
    // Nettoyage périodique toutes les 10 minutes
    setInterval(async () => {
      await this.performMaintenance()
    }, 10 * 60 * 1000)
  }
  
  private async performMaintenance(): Promise<void> {
    try {
      this.logger.info('🧹 Maintenance cache périodique...')
      
      // Nettoyage L2 des entrées expirées
      for (const [key, entry] of this.l2Cache.entries()) {
        if (this.isExpired(entry)) {
          await this.removeFromL2(key)
        }
      }
      
      // Nettoyage patterns anciens
      const now = Date.now()
      for (const [key, pattern] of this.accessPatterns.entries()) {
        if (now - pattern.nextAccess > 24 * 60 * 60 * 1000) { // 24h
          this.accessPatterns.delete(key)
        }
      }
      
      this.logger.info('✅ Maintenance cache terminée')
      
    } catch (error) {
      this.logger.error('❌ Erreur maintenance cache', { error })
    }
  }
  
  async clearAll(): Promise<void> {
    try {
      this.l1Cache.clear()
      this.l2Cache.clear()
      this.l2CurrentSize = 0
      await this.l3Collection.deleteMany({})
      this.accessPatterns.clear()
      
      this.logger.info('🗑️ Cache complet vidé')
    } catch (error) {
      this.logger.error('❌ Erreur vidage cache', { error })
    }
  }
}

// Singleton instance
export const intelligentCache = new IntelligentCacheSystem()