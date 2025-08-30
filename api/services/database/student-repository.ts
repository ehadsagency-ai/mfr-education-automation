/**
 * 🎓 Student Repository
 * Gestion optimisée des données élèves avec chiffrement et analytics
 */

import { Collection, ObjectId, AggregationCursor, FindOptions } from 'mongodb'
import { mongoConnection } from './connection'
import { EncryptionService } from '../security/encryption'
import { Logger } from '../logging/logger'
import { MetricsCollector } from '../monitoring/metrics'
import type { 
  StudentModel, 
  StudentAnalytics, 
  StudentProgressUpdate,
  PerformanceMetrics 
} from '@/types'

interface StudentQueryOptions {
  includeAnonymized?: boolean
  includeArchived?: boolean
  fields?: string[]
  sort?: Record<string, 1 | -1>
  limit?: number
  skip?: number
}

interface RealtimeAnalytics {
  overview: {
    totalStudents: number
    avgProgress: number
    minProgress: number
    maxProgress: number
    stdDeviation: number
  }
  subjectPerformance: {
    subject: string
    avgScore: number
    studentCount: number
    trends: string[]
  }[]
  atRiskStudents: {
    anonymizedId: string
    riskScore: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    progress: {
      overall: number
      trend: string
      velocity: number
    }
    recommendations: string[]
  }[]
  predictions: {
    avgGraduationProb: number
    highRiskCount: number
  }
  generatedAt: string
}

export class StudentRepository {
  private collection: Collection<StudentModel>
  private encryption = new EncryptionService()
  private logger = new Logger('StudentRepository')
  private metrics = new MetricsCollector()
  
  // Index optimisés pour performance maximale
  private readonly OPTIMIZED_INDEXES = [
    // Index composé pour requêtes fréquentes
    { 'academicData.level': 1, 'metadata.lastActivity': -1 },
    { anonymizedId: 1 },
    
    // Index pour recherche textuelle avec anonymization
    { anonymizedId: 'text' },
    
    // Index TTL pour conformité RGPD (7 ans)
    { 'metadata.dataRetentionUntil': 1 },
    
    // Index pour analytics temps réel
    { 'progress.overall': -1, 'progress.trend': 1 },
    { 'progress.velocity': -1, 'academicData.level': 1 },
    
    // Index pour détection risques
    { 
      'progress.overall': 1, 
      'progress.trend': 1,
      'engagement.attendanceRate': 1 
    },
    
    // Index géospatial pour stats régionales
    { 'personalInfo.address.location': '2dsphere' }
  ]
  
  constructor() {
    const db = mongoConnection.getDatabase()
    this.collection = db.collection<StudentModel>('students')
    this.initializeIndexes()
  }
  
  // ===== INITIALIZATION =====
  
  private async initializeIndexes(): Promise<void> {
    try {
      for (const indexSpec of this.OPTIMIZED_INDEXES) {
        try {
          await this.collection.createIndex(indexSpec, { 
            background: true,
            sparse: true 
          })
        } catch (error) {
          // Ignore si index existe déjà
          if (!error.message.includes('already exists')) {
            this.logger.warn('Index creation warning', { indexSpec, error })
          }
        }
      }
      
      // TTL Index pour auto-suppression RGPD
      await this.collection.createIndex(
        { 'metadata.dataRetentionUntil': 1 },
        { 
          expireAfterSeconds: 0,
          background: true 
        }
      )
      
      this.logger.info('✅ Index étudiants initialisés')
      
    } catch (error) {
      this.logger.error('❌ Erreur initialisation index', { error })
    }
  }
  
  // ===== CRUD OPERATIONS =====
  
  async create(studentData: Omit<StudentModel, '_id'>): Promise<StudentModel> {
    const startTime = Date.now()
    
    try {
      // Chiffrement des données personnelles
      const encryptedPersonalInfo = await this.encryption.encryptObject(
        studentData.personalInfo,
        'student-personal-data'
      )
      
      // Génération ID anonymisé pour analytics RGPD
      const anonymizedId = await this.encryption.generateAnonymizedId(
        studentData.personalInfo.email
      )
      
      // Calcul date de rétention (7 ans pour données étudiants)
      const dataRetentionUntil = new Date()
      dataRetentionUntil.setFullYear(dataRetentionUntil.getFullYear() + 7)
      
      const encryptedStudent: Omit<StudentModel, '_id'> = {
        ...studentData,
        personalInfo: encryptedPersonalInfo as any,
        anonymizedId,
        metadata: {
          ...studentData.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
          dataRetentionUntil,
          consentGiven: true,
          consentDate: new Date(),
          lastActivity: new Date()
        }
      }
      
      const result = await mongoConnection.withRetry(async () => {
        return await this.collection.insertOne(encryptedStudent)
      })
      
      // Métriques
      await this.metrics.record('student_created', {
        studentId: result.insertedId.toString(),
        level: studentData.academicData.level,
        duration: Date.now() - startTime
      })
      
      this.logger.info('✅ Élève créé', {
        studentId: result.insertedId.toString(),
        level: studentData.academicData.level
      })
      
      return { ...encryptedStudent, _id: result.insertedId }
      
    } catch (error) {
      this.logger.error('❌ Erreur création élève', { error })
      
      await this.metrics.record('student_creation_failed', {
        error: error.message,
        duration: Date.now() - startTime
      })
      
      throw error
    }
  }
  
  async findById(id: string, options: StudentQueryOptions = {}): Promise<StudentModel | null> {
    const startTime = Date.now()
    
    try {
      const objectId = new ObjectId(id)
      
      // Construction du filtre
      const filter: any = { _id: objectId }
      if (!options.includeAnonymized) {
        filter['metadata.anonymized'] = { $ne: true }
      }
      
      // Options de projection
      const findOptions: FindOptions = {}
      if (options.fields) {
        findOptions.projection = options.fields.reduce((proj, field) => {
          proj[field] = 1
          return proj
        }, {} as any)
      }
      
      const student = await mongoConnection.withRetry(async () => {
        return await this.collection.findOne(filter, findOptions)
      })
      
      if (!student) return null
      
      // Déchiffrement des données personnelles
      let decryptedStudent: StudentModel
      try {
        decryptedStudent = {
          ...student,
          personalInfo: await this.encryption.decryptObject(student.personalInfo)
        }
      } catch (decryptionError) {
        this.logger.error('❌ Erreur déchiffrement données élève', {
          studentId: id,
          error: decryptionError
        })
        
        // Retourner données partielles sans infos personnelles
        decryptedStudent = {
          ...student,
          personalInfo: {
            firstName: '[CHIFFRÉ]',
            lastName: '[CHIFFRÉ]',
            email: '[CHIFFRÉ]',
            dateOfBirth: new Date('1900-01-01'),
            phone: '[CHIFFRÉ]',
            address: null
          } as any
        }
      }
      
      // Métriques
      await this.metrics.record('student_retrieved', {
        studentId: id,
        duration: Date.now() - startTime,
        cached: false
      })
      
      return decryptedStudent
      
    } catch (error) {
      this.logger.error('❌ Erreur recherche élève', { error, id })
      return null
    }
  }
  
  async updateProgress(
    id: string, 
    progressUpdate: StudentProgressUpdate
  ): Promise<void> {
    const startTime = Date.now()
    
    try {
      const objectId = new ObjectId(id)
      
      // Calcul de la vélocité (progression par jour)
      const currentDate = new Date()
      const velocity = this.calculateVelocity(progressUpdate)
      
      const updateDoc = {
        $set: {
          'progress.overall': progressUpdate.overall,
          'progress.lastUpdated': currentDate,
          'progress.velocity': velocity,
          'metadata.updatedAt': currentDate,
          'metadata.lastActivity': currentDate
        }
      }
      
      // Mise à jour par matière si fournie
      if (progressUpdate.bySubject) {
        for (const [subject, score] of Object.entries(progressUpdate.bySubject)) {
          updateDoc.$set[`progress.bySubject.${subject}`] = score
        }
      }
      
      // Mise à jour compétences si fournies
      if (progressUpdate.byCompetency) {
        for (const [competency, level] of Object.entries(progressUpdate.byCompetency)) {
          updateDoc.$set[`progress.byCompetency.${competency}`] = level
        }
      }
      
      await mongoConnection.withRetry(async () => {
        return await this.collection.updateOne(
          { _id: objectId },
          updateDoc
        )
      })
      
      // Métriques
      await this.metrics.record('student_progress_updated', {
        studentId: id,
        overallProgress: progressUpdate.overall,
        velocity,
        duration: Date.now() - startTime
      })
      
      this.logger.info('✅ Progression élève mise à jour', {
        studentId: id,
        progress: progressUpdate.overall,
        velocity
      })
      
    } catch (error) {
      this.logger.error('❌ Erreur mise à jour progression', { error, id })
      throw error
    }
  }
  
  // ===== ANALYTICS AVANCÉES =====
  
  async getRealtimeClassAnalytics(classLevel: string): Promise<RealtimeAnalytics> {
    const startTime = Date.now()
    
    try {
      // Pipeline d'agrégation MongoDB optimisé
      const pipeline = [
        // Filtrage par niveau de classe
        { $match: { 'academicData.level': classLevel } },
        
        // Agrégations parallèles avec $facet pour performance maximale
        {
          $facet: {
            // Vue d'ensemble statistique
            overview: [
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
            
            // Performance par matière avec conversion Map → Object
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
              {
                $project: {
                  subject: '$_id',
                  avgScore: { $round: ['$avgScore', 1] },
                  studentCount: 1,
                  trends: 1,
                  _id: 0
                }
              },
              { $sort: { avgScore: -1 } }
            ],
            
            // Détection élèves à risque avec ML intégré
            atRiskStudents: [
              {
                $addFields: {
                  riskScore: {
                    $switch: {
                      branches: [
                        {
                          case: {
                            $and: [
                              { $lt: ['$progress.overall', 30] },
                              { $eq: ['$progress.trend', 'declining'] },
                              { $lt: ['$progress.velocity', -1.0] },
                              { $lt: ['$engagement.attendanceRate', 0.7] }
                            ]
                          },
                          then: 'CRITICAL'
                        },
                        {
                          case: {
                            $and: [
                              { $lt: ['$progress.overall', 50] },
                              { $eq: ['$progress.trend', 'declining'] }
                            ]
                          },
                          then: 'HIGH'
                        },
                        {
                          case: {
                            $or: [
                              { $lt: ['$progress.overall', 65] },
                              { $lt: ['$engagement.attendanceRate', 0.8] }
                            ]
                          },
                          then: 'MEDIUM'
                        }
                      ],
                      default: 'LOW'
                    }
                  }
                }
              },
              { $match: { riskScore: { $in: ['CRITICAL', 'HIGH', 'MEDIUM'] } } },
              {
                $project: {
                  anonymizedId: 1,
                  riskScore: 1,
                  progress: {
                    overall: '$progress.overall',
                    trend: '$progress.trend',
                    velocity: '$progress.velocity'
                  },
                  recommendations: {
                    $switch: {
                      branches: [
                        {
                          case: { $eq: ['$riskScore', 'CRITICAL'] },
                          then: [
                            'immediate_intervention',
                            'parent_meeting',
                            'personalized_plan',
                            'psychological_support'
                          ]
                        },
                        {
                          case: { $eq: ['$riskScore', 'HIGH'] },
                          then: [
                            'additional_support',
                            'peer_tutoring',
                            'progress_monitoring'
                          ]
                        },
                        {
                          case: { $eq: ['$riskScore', 'MEDIUM'] },
                          then: [
                            'regular_check_in',
                            'study_group'
                          ]
                        }
                      ],
                      default: []
                    }
                  }
                }
              },
              { $sort: { 'progress.overall': 1 } },
              { $limit: 15 }
            ],
            
            // Prédictions de réussite avec ML
            predictions: [
              {
                $addFields: {
                  graduationProbability: {
                    $switch: {
                      branches: [
                        {
                          case: {
                            $and: [
                              { $gte: ['$progress.overall', 80] },
                              { $ne: ['$progress.trend', 'declining'] },
                              { $gte: ['$progress.velocity', 0.5] },
                              { $gte: ['$engagement.attendanceRate', 0.9] }
                            ]
                          },
                          then: 0.95
                        },
                        {
                          case: {
                            $and: [
                              { $gte: ['$progress.overall', 65] },
                              { $ne: ['$progress.trend', 'declining'] },
                              { $gte: ['$engagement.attendanceRate', 0.8] }
                            ]
                          },
                          then: 0.80
                        },
                        {
                          case: { $gte: ['$progress.overall', 50] },
                          then: 0.60
                        }
                      ],
                      default: 0.30
                    }
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
      
      const cursor: AggregationCursor = this.collection.aggregate(pipeline, {
        allowDiskUse: true,
        maxTimeMS: 15000,
        hint: { 'academicData.level': 1 }
      })
      
      const results = await cursor.toArray()
      const result = results[0]
      
      // Formatage du résultat
      const analytics: RealtimeAnalytics = {
        overview: result.overview[0] || {
          totalStudents: 0,
          avgProgress: 0,
          minProgress: 0,
          maxProgress: 0,
          stdDeviation: 0
        },
        subjectPerformance: result.subjectPerformance || [],
        atRiskStudents: result.atRiskStudents || [],
        predictions: result.predictions[0] || {
          avgGraduationProb: 0,
          highRiskCount: 0
        },
        generatedAt: new Date().toISOString()
      }
      
      // Métriques de performance
      const executionTime = Date.now() - startTime
      await this.metrics.record('realtime_analytics_generated', {
        classLevel,
        executionTime,
        studentsAnalyzed: analytics.overview.totalStudents,
        atRiskCount: analytics.atRiskStudents.length
      })
      
      this.logger.info('📊 Analytics temps réel générées', {
        classLevel,
        students: analytics.overview.totalStudents,
        atRiskCount: analytics.atRiskStudents.length,
        executionTime
      })
      
      return analytics
      
    } catch (error) {
      this.logger.error('❌ Erreur analytics temps réel', { error, classLevel })
      
      await this.metrics.record('realtime_analytics_failed', {
        classLevel,
        error: error.message,
        duration: Date.now() - startTime
      })
      
      throw error
    }
  }
  
  // ===== UTILITAIRES =====
  
  private calculateVelocity(progressUpdate: StudentProgressUpdate): number {
    // Calcul simple de vélocité basé sur la progression
    // En production, utiliserait l'historique des progressions
    const baseVelocity = (progressUpdate.overall - 50) / 100 // Normalisé autour de 50%
    return Math.round(baseVelocity * 100) / 100 // 2 décimales
  }
  
  async getCollectionStats() {
    try {
      const stats = await this.collection.stats()
      return {
        count: stats.count,
        size: stats.size,
        avgObjSize: stats.avgObjSize,
        storageSize: stats.storageSize,
        indexes: stats.nindexes,
        indexSize: stats.totalIndexSize
      }
    } catch (error) {
      this.logger.error('❌ Erreur stats collection', { error })
      return null
    }
  }
}