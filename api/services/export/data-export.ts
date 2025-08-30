/**
 * 📊 Data Export/Import System
 * Système d'export massif pour conformité RGPD et archivage
 */

import { createWriteStream, createReadStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import * as XLSX from 'xlsx'
import PDFDocument from 'pdfkit'
import { create } from 'xmlbuilder2'
import { Logger } from '../logging/logger'
import { MetricsCollector } from '../monitoring/metrics'
import { EncryptionService } from '../security/encryption'
import { mongoConnection } from '../database/connection'
import type { 
  ExportFormat,
  ExportType, 
  ExportOptions,
  ExportResult,
  ExportJob,
  ExportMetadata 
} from '@/types/export'

interface ExportProgress {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  recordsProcessed: number
  totalRecords: number
  startTime: Date
  estimatedCompletion?: Date
  filePath?: string
  fileSize?: number
  error?: string
}

export class DataExportSystem {
  private logger = new Logger('DataExportSystem')
  private metrics = new MetricsCollector()
  private encryption = new EncryptionService()
  
  private jobsCollection = mongoConnection.getDatabase().collection<ExportJob>('export_jobs')
  private activeJobs = new Map<string, ExportProgress>()
  
  // Limites de sécurité
  private readonly MAX_RECORDS_PER_EXPORT = 50000
  private readonly MAX_CONCURRENT_JOBS = 3
  private readonly EXPORT_RETENTION_DAYS = 30
  
  constructor() {
    this.initializeCollections()
    this.setupCleanupJob()
  }
  
  // ===== INITIALIZATION =====
  
  private async initializeCollections(): Promise<void> {
    try {
      await this.jobsCollection.createIndex({ jobId: 1 }, { unique: true })
      await this.jobsCollection.createIndex({ userId: 1, createdAt: -1 })
      await this.jobsCollection.createIndex({ status: 1 })
      await this.jobsCollection.createIndex({ 
        createdAt: 1 
      }, { 
        expireAfterSeconds: this.EXPORT_RETENTION_DAYS * 24 * 60 * 60 
      })
      
      this.logger.info('✅ Collections export initialisées')
    } catch (error) {
      this.logger.error('❌ Erreur initialisation export', { error })
    }
  }
  
  private setupCleanupJob(): void {
    // Nettoyage périodique des fichiers expirés
    setInterval(async () => {
      await this.cleanupExpiredExports()
    }, 24 * 60 * 60 * 1000) // Quotidien
  }
  
  // ===== MAIN EXPORT INTERFACE =====
  
  async exportData(
    userId: string,
    exportType: ExportType,
    format: ExportFormat,
    options: ExportOptions = {}
  ): Promise<string> { // Retourne jobId
    try {
      // Vérification des limites
      if (this.activeJobs.size >= this.MAX_CONCURRENT_JOBS) {
        throw new Error('Limite d\'exports simultanés atteinte. Réessayez plus tard.')
      }
      
      // Génération d'un ID unique pour le job
      const jobId = this.generateJobId()
      
      // Estimation du nombre d'enregistrements
      const estimatedRecords = await this.estimateRecordCount(exportType, options)
      
      if (estimatedRecords > this.MAX_RECORDS_PER_EXPORT) {
        throw new Error(`Export trop volumineux (${estimatedRecords} enregistrements). Limite: ${this.MAX_RECORDS_PER_EXPORT}`)
      }
      
      // Création du job
      const job: ExportJob = {
        jobId,
        userId: await this.encryption.hashForAudit(userId),
        exportType,
        format,
        options,
        status: 'pending',
        createdAt: new Date(),
        estimatedRecords,
        metadata: {
          requestedBy: userId,
          exportReason: options.reason || 'user_request',
          anonymizeData: options.anonymize || false,
          includeDeleted: options.includeDeleted || false
        }
      }
      
      await this.jobsCollection.insertOne(job)
      
      // Initialisation du progress tracking
      this.activeJobs.set(jobId, {
        jobId,
        status: 'pending',
        progress: 0,
        recordsProcessed: 0,
        totalRecords: estimatedRecords,
        startTime: new Date()
      })
      
      // Démarrage asynchrone de l'export
      this.processExportJob(job).catch(error => {
        this.logger.error('❌ Erreur traitement export job', { jobId, error })
      })
      
      await this.metrics.record('export_job_created', {
        jobId,
        userId: await this.encryption.hashForAudit(userId),
        exportType,
        format,
        estimatedRecords
      })
      
      this.logger.info('📤 Job export créé', {
        jobId,
        exportType,
        format,
        estimatedRecords
      })
      
      return jobId
      
    } catch (error) {
      this.logger.error('❌ Erreur création export', { userId, exportType, error })
      throw error
    }
  }
  
  // ===== EXPORT PROCESSING =====
  
  private async processExportJob(job: ExportJob): Promise<void> {
    const progress = this.activeJobs.get(job.jobId)!
    
    try {
      progress.status = 'processing'
      await this.updateJobStatus(job.jobId, 'processing')
      
      // Récupération des données
      this.logger.info('📊 Début récupération données...', { jobId: job.jobId })
      const dataStream = await this.createDataStream(job.exportType, job.options)
      
      // Génération du fichier selon le format
      const filePath = await this.generateExportFile(job, dataStream, progress)
      
      // Finalisation
      progress.status = 'completed'
      progress.progress = 100
      progress.filePath = filePath
      
      await this.finalizeExport(job.jobId, filePath)
      
      this.logger.info('✅ Export terminé avec succès', {
        jobId: job.jobId,
        filePath,
        recordsProcessed: progress.recordsProcessed
      })
      
    } catch (error) {
      progress.status = 'failed'
      progress.error = error.message
      
      await this.updateJobStatus(job.jobId, 'failed', error.message)
      
      this.logger.error('❌ Échec export job', {
        jobId: job.jobId,
        error
      })
    } finally {
      // Nettoyage après délai
      setTimeout(() => {
        this.activeJobs.delete(job.jobId)
      }, 24 * 60 * 60 * 1000) // 24h
    }
  }
  
  // ===== DATA RETRIEVAL =====
  
  private async createDataStream(
    exportType: ExportType,
    options: ExportOptions
  ): Promise<Transform> {
    const db = mongoConnection.getDatabase()
    
    // Sélection de la collection et pipeline selon le type
    let collection: any
    let pipeline: any[]
    
    switch (exportType) {
      case 'student_complete':
        collection = db.collection('students')
        pipeline = this.buildStudentCompletePipeline(options)
        break
        
      case 'class_summary':
        collection = db.collection('students')
        pipeline = this.buildClassSummaryPipeline(options)
        break
        
      case 'establishment_report':
        collection = db.collection('students')
        pipeline = this.buildEstablishmentReportPipeline(options)
        break
        
      case 'rgpd_audit':
        collection = db.collection('audit_trail')
        pipeline = this.buildRGPDAuditPipeline(options)
        break
        
      default:
        throw new Error(`Type d'export non supporté: ${exportType}`)
    }
    
    // Création du stream de données
    const cursor = collection.aggregate(pipeline, {
      allowDiskUse: true,
      batchSize: 1000
    })
    
    return new Transform({
      objectMode: true,
      async transform(chunk, encoding, callback) {
        try {
          // Traitement/anonymisation si nécessaire
          const processedChunk = options.anonymize 
            ? await this.anonymizeData(chunk, exportType)
            : chunk
            
          callback(null, processedChunk)
        } catch (error) {
          callback(error)
        }
      }
    })
  }
  
  // ===== PIPELINE BUILDERS =====
  
  private buildStudentCompletePipeline(options: ExportOptions): any[] {
    const pipeline: any[] = []
    
    // Filtrage par classe si spécifié
    if (options.classId) {
      pipeline.push({ $match: { 'academicData.level': options.classId } })
    }
    
    // Filtrage par période
    if (options.dateRange) {
      pipeline.push({
        $match: {
          'metadata.createdAt': {
            $gte: new Date(options.dateRange.start),
            $lte: new Date(options.dateRange.end)
          }
        }
      })
    }
    
    // Projection des champs nécessaires
    pipeline.push({
      $project: {
        _id: 1,
        anonymizedId: 1,
        'academicData.level': 1,
        'academicData.year': 1,
        'academicData.subjects': 1,
        'progress.overall': 1,
        'progress.bySubject': 1,
        'progress.trend': 1,
        'engagement.attendanceRate': 1,
        'engagement.participationScore': 1,
        'metadata.createdAt': 1,
        'metadata.lastActivity': 1,
        // Données personnelles seulement si pas d'anonymisation
        ...(options.anonymize ? {} : {
          'personalInfo': 1
        })
      }
    })
    
    return pipeline
  }
  
  private buildClassSummaryPipeline(options: ExportOptions): any[] {
    return [
      { $match: { 'academicData.level': options.classId } },
      {
        $group: {
          _id: '$academicData.level',
          totalStudents: { $sum: 1 },
          avgProgress: { $avg: '$progress.overall' },
          avgAttendance: { $avg: '$engagement.attendanceRate' },
          subjectStats: {
            $push: {
              subjects: '$academicData.subjects',
              progress: '$progress.bySubject'
            }
          }
        }
      }
    ]
  }
  
  private buildEstablishmentReportPipeline(options: ExportOptions): any[] {
    return [
      {
        $group: {
          _id: '$academicData.level',
          count: { $sum: 1 },
          avgProgress: { $avg: '$progress.overall' },
          progressDistribution: {
            $push: '$progress.overall'
          }
        }
      },
      { $sort: { _id: 1 } }
    ]
  }
  
  private buildRGPDAuditPipeline(options: ExportOptions): any[] {
    const pipeline: any[] = []
    
    // Filtrage par utilisateur si spécifié
    if (options.userId) {
      pipeline.push({ 
        $match: { 
          userId: this.encryption.hashForAudit(options.userId) 
        } 
      })
    }
    
    // Filtrage par période
    if (options.dateRange) {
      pipeline.push({
        $match: {
          timestamp: {
            $gte: new Date(options.dateRange.start),
            $lte: new Date(options.dateRange.end)
          }
        }
      })
    }
    
    // Projection pour audit RGPD
    pipeline.push({
      $project: {
        timestamp: 1,
        action: 1,
        resourceType: 1,
        resourceId: 1,
        legalBasis: 1,
        dataClassification: 1,
        success: 1,
        ipAddress: 1
      }
    })
    
    pipeline.push({ $sort: { timestamp: -1 } })
    
    return pipeline
  }
  
  // ===== FILE GENERATION =====
  
  private async generateExportFile(
    job: ExportJob,
    dataStream: Transform,
    progress: ExportProgress
  ): Promise<string> {
    const fileName = this.generateFileName(job)
    const filePath = `/tmp/exports/${fileName}`
    
    switch (job.format) {
      case 'pdf':
        return await this.generatePDFExport(filePath, dataStream, progress)
        
      case 'excel':
        return await this.generateExcelExport(filePath, dataStream, progress)
        
      case 'json':
        return await this.generateJSONExport(filePath, dataStream, progress)
        
      case 'xml':
        return await this.generateXMLExport(filePath, dataStream, progress)
        
      default:
        throw new Error(`Format d'export non supporté: ${job.format}`)
    }
  }
  
  private async generatePDFExport(
    filePath: string,
    dataStream: Transform,
    progress: ExportProgress
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument()
        const writeStream = createWriteStream(filePath)
        
        doc.pipe(writeStream)
        
        // En-tête du document
        doc.fontSize(20).text('Export MFR Education', 100, 100)
        doc.fontSize(12).text(`Généré le: ${new Date().toLocaleDateString('fr-FR')}`, 100, 130)
        
        let yPosition = 180
        let recordCount = 0
        
        // Stream de données
        dataStream.on('data', (record) => {
          recordCount++
          progress.recordsProcessed = recordCount
          progress.progress = Math.min((recordCount / progress.totalRecords) * 100, 90)
          
          // Ajout des données au PDF
          if (yPosition > 700) { // Nouvelle page
            doc.addPage()
            yPosition = 100
          }
          
          doc.text(JSON.stringify(record, null, 2), 100, yPosition)
          yPosition += 60
        })
        
        dataStream.on('end', () => {
          doc.end()
        })
        
        writeStream.on('finish', () => {
          progress.progress = 100
          resolve(filePath)
        })
        
        writeStream.on('error', reject)
        
      } catch (error) {
        reject(error)
      }
    })
  }
  
  private async generateExcelExport(
    filePath: string,
    dataStream: Transform,
    progress: ExportProgress
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const data: any[] = []
        let recordCount = 0
        
        dataStream.on('data', (record) => {
          recordCount++
          progress.recordsProcessed = recordCount
          progress.progress = Math.min((recordCount / progress.totalRecords) * 90, 90)
          
          data.push(record)
        })
        
        dataStream.on('end', () => {
          try {
            // Création du workbook Excel
            const workbook = XLSX.utils.book_new()
            const worksheet = XLSX.utils.json_to_sheet(data)
            
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Export')
            
            // Écriture du fichier
            XLSX.writeFile(workbook, filePath)
            
            progress.progress = 100
            resolve(filePath)
            
          } catch (error) {
            reject(error)
          }
        })
        
        dataStream.on('error', reject)
        
      } catch (error) {
        reject(error)
      }
    })
  }
  
  private async generateJSONExport(
    filePath: string,
    dataStream: Transform,
    progress: ExportProgress
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const writeStream = createWriteStream(filePath)
        
        writeStream.write('[\n')
        
        let recordCount = 0
        let isFirst = true
        
        dataStream.on('data', (record) => {
          recordCount++
          progress.recordsProcessed = recordCount
          progress.progress = Math.min((recordCount / progress.totalRecords) * 100, 90)
          
          if (!isFirst) {
            writeStream.write(',\n')
          }
          writeStream.write(JSON.stringify(record, null, 2))
          isFirst = false
        })
        
        dataStream.on('end', () => {
          writeStream.write('\n]')
          writeStream.end()
        })
        
        writeStream.on('finish', () => {
          progress.progress = 100
          resolve(filePath)
        })
        
        writeStream.on('error', reject)
        
      } catch (error) {
        reject(error)
      }
    })
  }
  
  private async generateXMLExport(
    filePath: string,
    dataStream: Transform,
    progress: ExportProgress
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const writeStream = createWriteStream(filePath)
        
        // En-tête XML
        writeStream.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        writeStream.write('<export>\n')
        writeStream.write(`  <metadata>\n`)
        writeStream.write(`    <generated>${new Date().toISOString()}</generated>\n`)
        writeStream.write(`    <source>MFR Education v2.0</source>\n`)
        writeStream.write(`  </metadata>\n`)
        writeStream.write('  <data>\n')
        
        let recordCount = 0
        
        dataStream.on('data', (record) => {
          recordCount++
          progress.recordsProcessed = recordCount
          progress.progress = Math.min((recordCount / progress.totalRecords) * 100, 90)
          
          // Conversion objet vers XML
          const xmlRecord = this.objectToXML(record, '    ')
          writeStream.write(`  <record>\n${xmlRecord}  </record>\n`)
        })
        
        dataStream.on('end', () => {
          writeStream.write('  </data>\n')
          writeStream.write('</export>')
          writeStream.end()
        })
        
        writeStream.on('finish', () => {
          progress.progress = 100
          resolve(filePath)
        })
        
        writeStream.on('error', reject)
        
      } catch (error) {
        reject(error)
      }
    })
  }
  
  // ===== UTILITY FUNCTIONS =====
  
  private generateJobId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  private generateFileName(job: ExportJob): string {
    const timestamp = new Date().toISOString().split('T')[0]
    return `mfr_${job.exportType}_${timestamp}.${job.format}`
  }
  
  private async estimateRecordCount(
    exportType: ExportType,
    options: ExportOptions
  ): Promise<number> {
    const db = mongoConnection.getDatabase()
    
    switch (exportType) {
      case 'student_complete':
      case 'class_summary':
        const filter = options.classId 
          ? { 'academicData.level': options.classId }
          : {}
        return await db.collection('students').countDocuments(filter)
        
      case 'establishment_report':
        return await db.collection('students').distinct('academicData.level').then(levels => levels.length)
        
      case 'rgpd_audit':
        const auditFilter: any = {}
        if (options.dateRange) {
          auditFilter.timestamp = {
            $gte: new Date(options.dateRange.start),
            $lte: new Date(options.dateRange.end)
          }
        }
        return await db.collection('audit_trail').countDocuments(auditFilter)
        
      default:
        return 1000 // Estimation par défaut
    }
  }
  
  private async anonymizeData(data: any, exportType: ExportType): Promise<any> {
    if (exportType === 'rgpd_audit') {
      return data // Pas d'anonymisation pour les audits
    }
    
    const anonymized = { ...data }
    
    // Suppression des champs sensibles
    if (anonymized.personalInfo) {
      delete anonymized.personalInfo
    }
    
    // Remplacement par ID anonymisé
    if (anonymized._id) {
      anonymized.studentId = anonymized.anonymizedId
      delete anonymized._id
    }
    
    return anonymized
  }
  
  private objectToXML(obj: any, indent: string = ''): string {
    let xml = ''
    
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue
      
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '_')
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        xml += `${indent}<${sanitizedKey}>\n`
        xml += this.objectToXML(value, indent + '  ')
        xml += `${indent}</${sanitizedKey}>\n`
      } else if (Array.isArray(value)) {
        xml += `${indent}<${sanitizedKey}>\n`
        for (const item of value) {
          xml += `${indent}  <item>${this.escapeXML(String(item))}</item>\n`
        }
        xml += `${indent}</${sanitizedKey}>\n`
      } else {
        xml += `${indent}<${sanitizedKey}>${this.escapeXML(String(value))}</${sanitizedKey}>\n`
      }
    }
    
    return xml
  }
  
  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  
  // ===== JOB MANAGEMENT =====
  
  async getJobStatus(jobId: string): Promise<ExportProgress | null> {
    return this.activeJobs.get(jobId) || null
  }
  
  async getJobHistory(userId: string, limit = 10): Promise<ExportJob[]> {
    try {
      const hashedUserId = await this.encryption.hashForAudit(userId)
      
      return await this.jobsCollection
        .find({ userId: hashedUserId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
        
    } catch (error) {
      this.logger.error('❌ Erreur récupération historique', { userId, error })
      return []
    }
  }
  
  private async updateJobStatus(
    jobId: string, 
    status: ExportJob['status'], 
    error?: string
  ): Promise<void> {
    try {
      const updateDoc: any = {
        status,
        updatedAt: new Date()
      }
      
      if (error) {
        updateDoc.error = error
      }
      
      await this.jobsCollection.updateOne(
        { jobId },
        { $set: updateDoc }
      )
      
    } catch (err) {
      this.logger.error('❌ Erreur mise à jour job status', { jobId, error: err })
    }
  }
  
  private async finalizeExport(jobId: string, filePath: string): Promise<void> {
    try {
      // Calcul de la taille du fichier
      const stats = require('fs').statSync(filePath)
      const fileSize = stats.size
      
      await this.jobsCollection.updateOne(
        { jobId },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            filePath,
            fileSize,
            downloadUrl: `/api/exports/download/${jobId}`
          }
        }
      )
      
      await this.metrics.record('export_completed', {
        jobId,
        fileSize,
        recordsProcessed: this.activeJobs.get(jobId)?.recordsProcessed || 0
      })
      
    } catch (error) {
      this.logger.error('❌ Erreur finalisation export', { jobId, error })
    }
  }
  
  private async cleanupExpiredExports(): Promise<void> {
    try {
      const expiredDate = new Date()
      expiredDate.setDate(expiredDate.getDate() - this.EXPORT_RETENTION_DAYS)
      
      const expiredJobs = await this.jobsCollection
        .find({ 
          createdAt: { $lt: expiredDate },
          filePath: { $exists: true }
        })
        .toArray()
      
      // Suppression des fichiers
      for (const job of expiredJobs) {
        try {
          if (job.filePath) {
            require('fs').unlinkSync(job.filePath)
          }
        } catch (error) {
          this.logger.warn('⚠️ Impossible de supprimer fichier export', {
            jobId: job.jobId,
            filePath: job.filePath
          })
        }
      }
      
      this.logger.info('🧹 Nettoyage exports expirés', {
        cleaned: expiredJobs.length
      })
      
    } catch (error) {
      this.logger.error('❌ Erreur nettoyage exports', { error })
    }
  }
}