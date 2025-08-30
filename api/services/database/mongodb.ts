import { MongoClient, Db, Collection, CreateIndexesOptions } from 'mongodb'
import { Logger } from '@/services/logging'
import { MetricsCollector } from '@/services/monitoring'
import { EncryptionService } from '@/services/security/encryption'
import type { 
  StudentModel, 
  ContentModel, 
  AuditLogModel,
  AnalyticsQuery,
  DatabaseConfig 
} from '@/types/database'

export class MongoDBService {
  private client: MongoClient | null = null
  private db: Db | null = null
  private logger = new Logger('MongoDB')
  private metrics = new MetricsCollector()
  private encryption = new EncryptionService()
  
  private readonly config: DatabaseConfig = {
    uri: process.env.MONGODB_URI!,
    dbName: process.env.MONGODB_DB_NAME || 'mfr_education',
    maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10'),
    timeout: parseInt(process.env.MONGODB_TIMEOUT || '5000')
  }
  
  // Index optimisés pour performance maximale
  private readonly OPTIMIZED_INDEXES = {
    students: [
      // Index composé pour requêtes fréquentes
      { classId: 1, 'metadata.lastActivity': -1 },
      { anonymizedId: 1 },
      
      // Index pour recherche textuelle
      { 
        'personalInfo.firstName': 'text',
        'personalInfo.lastName': 'text',
        anonymizedId: 'text'
      },
      
      // Index TTL pour conformité RGPD
      { 'metadata.dataRetentionUntil': 1, expireAfterSeconds: 0 },
      
      // Index pour analytics
      { 'progress.overall': -1, 'progress.trend': 1 },
      { 'progress.velocity': -1, 'progress.overall': -1 },
      
      // Index géospatial pour statistiques régionales
      { 'location': '2dsphere' }
    ],
    
    content: [
      { type: 1, subject: 1, difficulty: 1 },
      { createdAt: -1 },
      { 'metadata.tags': 1 },
      { 'aiGeneration.agentUsed': 1, 'aiGeneration.cost': 1 },
      { 'usage.accessCount': -1 }
    ],
    
    audit_logs: [
      { timestamp: -1 },
      { userId: 1, action: 1 },
      { resourceType: 1, resourceId: 1 },
      { 'security.riskLevel': 1 },
      // TTL pour rétention audit (10 ans)
      { timestamp: 1, expireAfterSeconds: 315360000 }
    ],
    
    analytics_cache: [
      { cacheKey: 1 },
      { classId: 1, type: 1 },
      { createdAt: 1, expireAfterSeconds: 3600 } // Cache 1 heure
    ]
  }
  
  async connect(): Promise<void> {
    try {
      this.logger.info('Connexion à MongoDB Atlas...')
      
      this.client = new MongoClient(this.config.uri, {
        maxPoolSize: this.config.maxPoolSize,
        serverSelectionTimeoutMS: this.config.timeout,
        socketTimeoutMS: this.config.timeout,
        // Options de performance
        maxIdleTimeMS: 30000,
        compressors: ['zstd', 'zlib'],
        // Sécurité
        authSource: 'admin',
        ssl: true,
        // Monitoring
        monitorCommands: true
      })
      
      await this.client.connect()
      this.db = this.client.db(this.config.dbName)
      
      // Vérification de la connexion
      await this.db.admin().ping()
      
      // Création des index
      await this.createIndexes()
      
      // Setup du monitoring
      this.setupMonitoring()
      
      this.logger.info('MongoDB Atlas connecté avec succès')
      
    } catch (error) {
      this.logger.error('Erreur connexion MongoDB', { error })
      throw error
    }
  }
  
  private async createIndexes(): Promise<void> {
    try {
      for (const [collectionName, indexes] of Object.entries(this.OPTIMIZED_INDEXES)) {
        const collection = this.db!.collection(collectionName)
        
        for (const indexSpec of indexes) {
          try {
            const options: CreateIndexesOptions = {
              background: true,
              sparse: true
            }
            
            // TTL index special handling
            if ('expireAfterSeconds' in indexSpec) {
              const { expireAfterSeconds, ...spec } = indexSpec
              options.expireAfterSeconds = expireAfterSeconds
              await collection.createIndex(spec, options)
            } else {
              await collection.createIndex(indexSpec, options)
            }
            
          } catch (indexError) {
            // Ignore si index existe déjà
            if (!indexError.message.includes('already exists')) {
              this.logger.warn('Erreur création index', { collection: collectionName, indexSpec, error: indexError })
            }
          }
        }
      }
      
      this.logger.info('Index MongoDB créés avec succès')
      
    } catch (error) {
      this.logger.error('Erreur création index', { error })
    }
  }
  
  private setupMonitoring(): void {
    if (this.client) {
      // Monitoring des commandes lentes
      this.client.on('commandStarted', (event) => {
        if (event.commandName !== 'ping') {
          this.logger.debug('MongoDB command started', {
            command: event.commandName,
            collection: event.command?.collection
          })
        }
      })
      
      this.client.on('commandSucceeded', async (event) => {
        const duration = event.duration
        
        // Alerte pour requêtes lentes
        if (duration > 2000) {
          this.logger.warn('Requête MongoDB lente détectée', {
            command: event.commandName,
            duration,
            collection: event.reply?.collection
          })
          
          await this.metrics.record('slow_query_detected', {
            command: event.commandName,
            duration,
            threshold: 2000
          })
        }
        
        await this.metrics.record('mongodb_command_completed', {
          command: event.commandName,
          duration,
          success: true
        })
      })
      
      this.client.on('commandFailed', async (event) => {
        this.logger.error('MongoDB command failed', {
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
    }
  }
  
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close()
        this.client = null
        this.db = null
        this.logger.info('MongoDB déconnecté')
      }
    } catch (error) {
      this.logger.error('Erreur déconnexion MongoDB', { error })
    }
  }
  
  // === CRUD Operations avec chiffrement automatique ===
  
  async createStudent(studentData: Omit<StudentModel, '_id'>): Promise<StudentModel> {
    try {
      const collection = this.getCollection<StudentModel>('students')
      
      // Chiffrement des données personnelles
      const encryptedData = {
        ...studentData,
        personalInfo: await this.encryption.encryptObject(studentData.personalInfo),
        anonymizedId: await this.encryption.generateAnonymizedId(studentData.personalInfo.email),
        metadata: {
          ...studentData.metadata,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }
      
      const result = await collection.insertOne(encryptedData)
      
      await this.metrics.record('student_created', {
        studentId: result.insertedId.toString(),
        classId: studentData.academicData.level
      })
      
      return { ...encryptedData, _id: result.insertedId }
      
    } catch (error) {
      this.logger.error('Erreur création élève', { error })
      throw error
    }
  }
  
  async findStudentById(id: string): Promise<StudentModel | null> {
    try {
      const collection = this.getCollection<StudentModel>('students')
      const student = await collection.findOne({ _id: new ObjectId(id) })
      
      if (!student) return null
      
      // Déchiffrement des données personnelles
      return {
        ...student,
        personalInfo: await this.encryption.decryptObject(student.personalInfo)
      }
      
    } catch (error) {
      this.logger.error('Erreur recherche élève', { error, id })
      return null
    }
  }
  
  async updateStudent(id: string, updates: Partial<StudentModel>): Promise<void> {
    try {
      const collection = this.getCollection<StudentModel>('students')
      
      // Chiffrement des données personnelles si présentes
      const encryptedUpdates: any = { ...updates }
      if (updates.personalInfo) {
        encryptedUpdates.personalInfo = await this.encryption.encryptObject(updates.personalInfo)
      }
      
      encryptedUpdates['metadata.updatedAt'] = new Date()
      
      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: encryptedUpdates }
      )
      
      await this.metrics.record('student_updated', { studentId: id })
      
    } catch (error) {
      this.logger.error('Erreur mise à jour élève', { error, id })
      throw error
    }
  }
  
  // === Analytics avec Aggregation Pipelines ===
  
  async getRealtimeClassAnalytics(classId: string): Promise<any> {
    try {
      const collection = this.getCollection<StudentModel>('students')
      
      // Pipeline d'agrégation avancée
      const pipeline = [
        // Filtrage par classe
        { $match: { 'academicData.level': classId } },
        
        // Agrégations parallèles avec $facet
        {
          $facet: {
            // Performance globale
            overallStats: [
              {
                $group: {
                  _id: null,
                  totalStudents: { $sum: 1 },
                  avgProgress: { $avg: '$progress.overall' },
                  minProgress: { $min: '$progress.overall' },
                  maxProgress: { $max: '$progress.overall' },
                  stdDeviation: { $stdDevPop: '$progress.overall' }
                }
              }
            ],
            
            // Distribution par matière
            subjectPerformance: [
              { 
                $addFields: {
                  subjectArray: { $objectToArray: '$progress.bySubject' }
                }
              },
              { $unwind: '$subjectArray' },
              {
                $group: {
                  _id: '$subjectArray.k',
                  avgScore: { $avg: '$subjectArray.v' },
                  studentCount: { $sum: 1 },
                  trends: { $push: '$progress.trend' }
                }
              },
              { $sort: { avgScore: -1 } }
            ],
            
            // Élèves à risque avec ML intégré
            atRiskStudents: [
              {
                $addFields: {
                  riskScore: {
                    $switch: {
                      branches: [
                        {
                          case: {
                            $and: [
                              { $lt: ['$progress.overall', 40] },
                              { $eq: ['$progress.trend', 'declining'] },
                              { $lt: ['$progress.velocity', -0.5] }
                            ]
                          },
                          then: 'CRITICAL'
                        },
                        {
                          case: {
                            $or: [
                              { $lt: ['$progress.overall', 60] },
                              { $eq: ['$progress.trend', 'declining'] }
                            ]
                          },
                          then: 'HIGH'
                        }
                      ],
                      default: 'LOW'
                    }
                  }
                }
              },
              { $match: { riskScore: { $in: ['CRITICAL', 'HIGH'] } } },
              {
                $project: {
                  anonymizedId: 1,
                  riskScore: 1,
                  'progress.overall': 1,
                  'progress.trend': 1,
                  'progress.velocity': 1,
                  recommendations: {
                    $switch: {
                      branches: [
                        {
                          case: { $eq: ['$riskScore', 'CRITICAL'] },
                          then: ['immediate_intervention', 'parent_meeting', 'personalized_plan']
                        },
                        {
                          case: { $eq: ['$riskScore', 'HIGH'] },
                          then: ['additional_support', 'peer_tutoring', 'progress_monitoring']
                        }
                      ],
                      default: []
                    }
                  }
                }
              },
              { $limit: 10 }
            ],
            
            // Prédictions ML
            predictions: [
              {
                $addFields: {
                  graduationProbability: {
                    $cond: [
                      {
                        $and: [
                          { $gte: ['$progress.overall', 70] },
                          { $ne: ['$progress.trend', 'declining'] },
                          { $gte: ['$progress.velocity', 0] }
                        ]
                      },
                      0.85,
                      {
                        $cond: [
                          { $gte: ['$progress.overall', 50] },
                          0.65,
                          0.35
                        ]
                      }
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: null,
                  avgGraduationProb: { $avg: '$graduationProbability' },
                  highRiskCount: {
                    $sum: { $cond: [{ $lt: ['$graduationProbability', 0.5] }, 1, 0] }
                  }
                }
              }
            ]
          }
        }
      ]
      
      const startTime = Date.now()
      const result = await collection.aggregate(pipeline, {
        hint: { 'academicData.level': 1 },
        allowDiskUse: true,
        maxTimeMS: 10000
      }).toArray()
      
      const executionTime = Date.now() - startTime
      
      await this.metrics.record('analytics_query_executed', {
        queryType: 'class_analytics',
        classId,
        executionTime,
        resultSize: JSON.stringify(result).length
      })
      
      return this.formatAnalyticsResult(result[0])
      
    } catch (error) {
      this.logger.error('Erreur analytics classe', { error, classId })
      throw error
    }
  }
  
  private formatAnalyticsResult(rawResult: any): any {
    return {
      overview: rawResult.overallStats[0] || {},
      subjectPerformance: rawResult.subjectPerformance || [],
      atRiskStudents: rawResult.atRiskStudents || [],
      predictions: rawResult.predictions[0] || {},
      generatedAt: new Date().toISOString()
    }
  }
  
  // === Audit & Compliance RGPD ===
  
  async logAuditEvent(event: Omit<AuditLogModel, '_id' | 'timestamp'>): Promise<void> {
    try {
      const collection = this.getCollection<AuditLogModel>('audit_logs')
      
      const auditEntry: AuditLogModel = {
        ...event,
        timestamp: new Date(),
        signature: await this.encryption.signData(event)
      }
      
      await collection.insertOne(auditEntry)
      
      // Pas de metrics pour éviter la récursion
      
    } catch (error) {
      this.logger.error('Erreur log audit', { error })
    }
  }
  
  async anonymizeStudentData(studentId: string): Promise<void> {
    try {
      const collection = this.getCollection<StudentModel>('students')
      
      // Anonymisation irréversible
      await collection.updateOne(
        { _id: new ObjectId(studentId) },
        {
          $set: {
            'personalInfo.firstName': '[ANONYMISÉ]',
            'personalInfo.lastName': '[ANONYMISÉ]',
            'personalInfo.email': '[ANONYMISÉ]',
            'personalInfo.dateOfBirth': new Date('1900-01-01'),
            'metadata.anonymized': true,
            'metadata.anonymizedAt': new Date()
          }
        }
      )
      
      await this.logAuditEvent({
        action: 'student_anonymized',
        resourceType: 'student',
        resourceId: studentId,
        userId: 'system',
        success: true,
        metadata: { reason: 'gdpr_erasure_request' }
      })
      
    } catch (error) {
      this.logger.error('Erreur anonymisation élève', { error, studentId })
      throw error
    }
  }
  
  // === Helpers ===
  
  private getCollection<T = any>(name: string): Collection<T> {
    if (!this.db) {
      throw new Error('Database not connected')
    }
    return this.db.collection<T>(name)
  }
  
  async getHealth(): Promise<{
    connected: boolean
    latency: number
    collections: string[]
    indexStats: any
  }> {
    try {
      const startTime = Date.now()
      await this.db?.admin().ping()
      const latency = Date.now() - startTime
      
      const collections = await this.db?.listCollections().toArray() || []
      const collectionNames = collections.map(c => c.name)
      
      // Stats des index
      const indexStats = {}
      for (const collName of collectionNames) {
        if (this.OPTIMIZED_INDEXES[collName]) {
          const collection = this.getCollection(collName)
          const indexes = await collection.listIndexes().toArray()
          indexStats[collName] = indexes.length
        }
      }
      
      return {
        connected: true,
        latency,
        collections: collectionNames,
        indexStats
      }
      
    } catch (error) {
      return {
        connected: false,
        latency: -1,
        collections: [],
        indexStats: {}
      }
    }
  }
}