/**
 * 🔐 Advanced RGPD Manager - Phase 3
 * Gestionnaire RGPD avancé avec audit immutable et conformité renforcée
 */

import crypto from 'crypto'
import { Logger } from '../logging/logger'
import { MetricsCollector } from '../monitoring/metrics'
import { EncryptionService } from './encryption'
import { mongoConnection } from '../database/connection'
import { DataExportSystem } from '../export/data-export'
import type { 
  ConsentRecord, 
  DataErasureRequest, 
  DataPortabilityRequest,
  PrivacyImpactAssessment,
  RGPDCompliance,
  PersonalDataInventory,
  BreachNotification
} from '@/types/security'

interface ImmutableAuditEntry {
  id: string
  timestamp: Date
  userId: string
  action: RGPDAction
  resourceType: string
  resourceId: string
  legalBasis: LegalBasis
  dataClassification: DataClassification
  ipAddress: string
  userAgent: string
  success: boolean
  details: Record<string, any>
  // Signature cryptographique pour immutabilité
  signature: string
  // Hash de chaînage pour détection de tampering
  previousHash: string
  blockHash: string
}

interface DataProcessingRecord {
  id: string
  purpose: string
  legalBasis: LegalBasis
  dataCategories: string[]
  dataSubjects: string[]
  recipients: string[]
  retentionPeriod: number
  crossBorderTransfers: boolean
  safeguards: string[]
  riskAssessment: 'low' | 'medium' | 'high'
  createdAt: Date
  lastReviewed: Date
}

interface ConsentMetrics {
  total: number
  byPurpose: Record<string, number>
  byStatus: Record<'given' | 'withdrawn' | 'expired', number>
  conversionRate: number
  withdrawalRate: number
  lastUpdated: Date
}

type RGPDAction = 'consent_given' | 'consent_withdrawn' | 'data_accessed' | 'data_modified' | 'data_exported' | 'data_deleted' | 'breach_detected' | 'impact_assessment'
type LegalBasis = 'consent' | 'contract' | 'legal_obligation' | 'vital_interests' | 'public_task' | 'legitimate_interests'
type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted'

export class AdvancedRGPDManager {
  private logger = new Logger('AdvancedRGPDManager')
  private metrics = new MetricsCollector()
  private encryption = new EncryptionService()
  private dataExport = new DataExportSystem()
  
  // Collections MongoDB
  private auditCollection = mongoConnection.getDatabase().collection<ImmutableAuditEntry>('rgpd_audit_immutable')
  private consentsCollection = mongoConnection.getDatabase().collection('rgpd_consents')
  private processingCollection = mongoConnection.getDatabase().collection('rgpd_processing_records')
  private breachCollection = mongoConnection.getDatabase().collection('rgpd_breach_notifications')
  private inventoryCollection = mongoConnection.getDatabase().collection('personal_data_inventory')
  
  // Blockchain-like chain pour audit trail
  private auditChain: string[] = []
  private lastBlockHash = '0000000000000000000000000000000000000000000000000000000000000000'
  
  constructor() {
    this.initializeCollections()
    this.initializeAuditChain()
  }
  
  // ===== INITIALIZATION =====
  
  private async initializeCollections(): Promise<void> {
    try {
      // Audit immutable avec index performance
      await this.auditCollection.createIndex({ userId: 1, timestamp: -1 })
      await this.auditCollection.createIndex({ action: 1, timestamp: -1 })
      await this.auditCollection.createIndex({ blockHash: 1 }, { unique: true })
      await this.auditCollection.createIndex({ signature: 1 })
      
      // Consentements avec TTL
      await this.consentsCollection.createIndex({ subjectId: 1 })
      await this.consentsCollection.createIndex({ purpose: 1, status: 1 })
      await this.consentsCollection.createIndex({ 
        expiresAt: 1 
      }, { 
        expireAfterSeconds: 0 
      })
      
      // Records de traitement
      await this.processingCollection.createIndex({ purpose: 1 })
      await this.processingCollection.createIndex({ lastReviewed: 1 })
      
      this.logger.info('✅ Collections RGPD initialisées')
    } catch (error) {
      this.logger.error('❌ Erreur initialisation RGPD', { error })
    }
  }
  
  private async initializeAuditChain(): Promise<void> {
    try {
      // Récupération du dernier hash de la chaîne
      const lastEntry = await this.auditCollection
        .findOne({}, { sort: { timestamp: -1 } })
      
      if (lastEntry) {
        this.lastBlockHash = lastEntry.blockHash
      }
      
      this.logger.info('✅ Chaîne audit RGPD initialisée', {
        lastHash: this.lastBlockHash.substring(0, 8)
      })
    } catch (error) {
      this.logger.error('❌ Erreur initialisation chaîne audit', { error })
    }
  }
  
  // ===== AUDIT TRAIL IMMUTABLE =====
  
  async logRGPDAction(
    userId: string,
    action: RGPDAction,
    resourceType: string,
    resourceId: string,
    options: {
      legalBasis: LegalBasis
      dataClassification: DataClassification
      ipAddress: string
      userAgent: string
      details?: Record<string, any>
    }
  ): Promise<void> {
    try {
      const timestamp = new Date()
      const entryId = crypto.randomUUID()
      
      // Génération du hash de l'entrée
      const entryData = {
        id: entryId,
        timestamp: timestamp.toISOString(),
        userId: await this.encryption.hashForAudit(userId),
        action,
        resourceType,
        resourceId: await this.encryption.hashForAudit(resourceId),
        legalBasis: options.legalBasis,
        dataClassification: options.dataClassification,
        ipAddress: await this.encryption.hashForAudit(options.ipAddress),
        userAgent: this.sanitizeUserAgent(options.userAgent),
        details: options.details || {}
      }
      
      // Calcul du hash de chaînage
      const previousHash = this.lastBlockHash
      const blockData = JSON.stringify({ ...entryData, previousHash })
      const blockHash = crypto.createHash('sha256').update(blockData).digest('hex')
      
      // Signature cryptographique
      const signature = await this.encryption.signData(entryData)
      
      const auditEntry: ImmutableAuditEntry = {
        ...entryData,
        timestamp,
        success: true,
        signature,
        previousHash,
        blockHash
      }
      
      // Stockage atomique
      await this.auditCollection.insertOne(auditEntry)
      
      // Mise à jour de la chaîne
      this.lastBlockHash = blockHash
      this.auditChain.push(blockHash)
      
      // Limitation de la chaîne en mémoire (garde les 1000 derniers)
      if (this.auditChain.length > 1000) {
        this.auditChain = this.auditChain.slice(-1000)
      }
      
      await this.metrics.record('rgpd_audit_logged', {
        action,
        resourceType,
        dataClassification: options.dataClassification
      })
      
      this.logger.debug('📝 Action RGPD auditée', {
        action,
        userId: entryData.userId.substring(0, 8),
        blockHash: blockHash.substring(0, 8)
      })
      
    } catch (error) {
      this.logger.error('❌ Erreur logging RGPD', { 
        userId, 
        action, 
        error 
      })
      throw error
    }
  }
  
  // ===== VALIDATION INTÉGRITÉ =====
  
  async validateAuditIntegrity(
    startDate?: Date, 
    endDate?: Date
  ): Promise<{
    isValid: boolean
    totalEntries: number
    validEntries: number
    invalidEntries: number
    brokenChains: number
    corruptedSignatures: number
  }> {
    try {
      const query: any = {}
      if (startDate || endDate) {
        query.timestamp = {}
        if (startDate) query.timestamp.$gte = startDate
        if (endDate) query.timestamp.$lte = endDate
      }
      
      const entries = await this.auditCollection
        .find(query)
        .sort({ timestamp: 1 })
        .toArray()
      
      let validEntries = 0
      let brokenChains = 0
      let corruptedSignatures = 0
      let previousHash = '0000000000000000000000000000000000000000000000000000000000000000'
      
      for (const entry of entries) {
        let isEntryValid = true
        
        // Validation de la signature
        try {
          const entryData = { ...entry }
          delete entryData.signature
          delete entryData.previousHash
          delete entryData.blockHash
          delete entryData._id
          
          const expectedSignature = await this.encryption.signData(entryData)
          if (entry.signature !== expectedSignature) {
            corruptedSignatures++
            isEntryValid = false
          }
        } catch (error) {
          corruptedSignatures++
          isEntryValid = false
        }
        
        // Validation du chaînage
        if (entry.previousHash !== previousHash) {
          brokenChains++
          isEntryValid = false
        }
        
        // Validation du hash du bloc
        const entryDataForHash = { ...entry }
        delete entryDataForHash.blockHash
        delete entryDataForHash._id
        
        const expectedBlockHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(entryDataForHash))
          .digest('hex')
          
        if (entry.blockHash !== expectedBlockHash) {
          isEntryValid = false
        }
        
        if (isEntryValid) {
          validEntries++
        }
        
        previousHash = entry.blockHash
      }
      
      const result = {
        isValid: brokenChains === 0 && corruptedSignatures === 0,
        totalEntries: entries.length,
        validEntries,
        invalidEntries: entries.length - validEntries,
        brokenChains,
        corruptedSignatures
      }
      
      await this.metrics.record('rgpd_audit_validation', result)
      
      this.logger.info('🔍 Validation intégrité audit RGPD', result)
      
      return result
      
    } catch (error) {
      this.logger.error('❌ Erreur validation intégrité', { error })
      throw error
    }
  }
  
  // ===== GESTION CONSENTEMENTS AVANCÉE =====
  
  async recordAdvancedConsent(
    subjectId: string,
    consentData: {
      purposes: string[]
      dataCategories: string[]
      retentionPeriods: Record<string, number>
      thirdParties?: string[]
      marketingConsent?: boolean
      profileBuilding?: boolean
      crossBorderTransfer?: boolean
    },
    context: {
      ipAddress: string
      userAgent: string
      timestamp?: Date
      consentMethod: 'explicit' | 'implicit' | 'opt_in' | 'pre_ticked'
      consentEvidence: string
    }
  ): Promise<string> {
    try {
      const consentId = crypto.randomUUID()
      const timestamp = context.timestamp || new Date()
      
      // Calcul de l'expiration basée sur la période de rétention max
      const maxRetention = Math.max(...Object.values(consentData.retentionPeriods))
      const expiresAt = new Date(timestamp.getTime() + maxRetention * 24 * 60 * 60 * 1000)
      
      const consent: ConsentRecord = {
        id: consentId,
        subjectId: await this.encryption.hashForAudit(subjectId),
        purposes: consentData.purposes,
        dataCategories: consentData.dataCategories,
        status: 'given',
        timestamp,
        expiresAt,
        withdrawnAt: null,
        legalBasis: 'consent',
        consentMethod: context.consentMethod,
        consentEvidence: context.consentEvidence,
        ipAddress: await this.encryption.hashForAudit(context.ipAddress),
        userAgent: this.sanitizeUserAgent(context.userAgent),
        metadata: {
          retentionPeriods: consentData.retentionPeriods,
          thirdParties: consentData.thirdParties || [],
          marketingConsent: consentData.marketingConsent || false,
          profileBuilding: consentData.profileBuilding || false,
          crossBorderTransfer: consentData.crossBorderTransfer || false
        }
      }
      
      // Stockage chiffré
      await this.consentsCollection.insertOne({
        ...consent,
        // Chiffrement des métadonnées sensibles
        metadata: await this.encryption.encryptObject(consent.metadata)
      })
      
      // Audit trail
      await this.logRGPDAction(
        subjectId,
        'consent_given',
        'consent',
        consentId,
        {
          legalBasis: 'consent',
          dataClassification: 'restricted',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          details: {
            purposes: consentData.purposes,
            consentMethod: context.consentMethod
          }
        }
      )
      
      this.logger.info('✅ Consentement RGPD enregistré', {
        consentId,
        purposes: consentData.purposes.length,
        method: context.consentMethod
      })
      
      return consentId
      
    } catch (error) {
      this.logger.error('❌ Erreur enregistrement consentement', { 
        subjectId, 
        error 
      })
      throw error
    }
  }
  
  // ===== DROITS DES PERSONNES =====
  
  async processDataPortabilityRequest(
    subjectId: string,
    requestData: {
      requestedFormats: ('json' | 'xml' | 'pdf' | 'excel')[]
      dataCategories?: string[]
      dateRange?: { start: Date; end: Date }
      includeMeta?: boolean
    },
    context: {
      ipAddress: string
      userAgent: string
      requestMethod: 'web' | 'email' | 'letter'
    }
  ): Promise<string> {
    try {
      const requestId = crypto.randomUUID()
      
      // Vérification du consentement valide
      const validConsent = await this.hasValidConsent(subjectId)
      if (!validConsent) {
        throw new Error('Aucun consentement valide trouvé pour ce sujet')
      }
      
      // Initiation de l'export avec le système d'export
      const exportJobId = await this.dataExport.exportData(
        subjectId,
        'student_complete',
        requestData.requestedFormats[0] || 'json',
        {
          anonymize: false, // Export complet pour portabilité
          includeDeleted: false,
          dateRange: requestData.dateRange,
          reason: 'data_portability_request',
          includeMetadata: requestData.includeMeta
        }
      )
      
      // Stockage de la demande
      const portabilityRequest: DataPortabilityRequest = {
        id: requestId,
        subjectId: await this.encryption.hashForAudit(subjectId),
        requestedFormats: requestData.requestedFormats,
        dataCategories: requestData.dataCategories || ['all'],
        dateRange: requestData.dateRange,
        status: 'processing',
        requestedAt: new Date(),
        exportJobId,
        deliveryMethod: 'download',
        ipAddress: await this.encryption.hashForAudit(context.ipAddress),
        userAgent: this.sanitizeUserAgent(context.userAgent)
      }
      
      await mongoConnection.getDatabase()
        .collection('data_portability_requests')
        .insertOne(portabilityRequest)
      
      // Audit trail
      await this.logRGPDAction(
        subjectId,
        'data_exported',
        'data_portability',
        requestId,
        {
          legalBasis: 'consent',
          dataClassification: 'restricted',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          details: {
            requestedFormats: requestData.requestedFormats,
            exportJobId
          }
        }
      )
      
      this.logger.info('📤 Demande de portabilité traitée', {
        requestId,
        exportJobId,
        formats: requestData.requestedFormats
      })
      
      return requestId
      
    } catch (error) {
      this.logger.error('❌ Erreur portabilité données', { 
        subjectId, 
        error 
      })
      throw error
    }
  }
  
  async processDataErasureRequest(
    subjectId: string,
    requestData: {
      reason: 'consent_withdrawn' | 'no_longer_necessary' | 'unlawful_processing' | 'other'
      specificData?: string[]
      keepAnonymized?: boolean
    },
    context: {
      ipAddress: string
      userAgent: string
    }
  ): Promise<string> {
    try {
      const requestId = crypto.randomUUID()
      
      // Création de la demande d'effacement
      const erasureRequest: DataErasureRequest = {
        id: requestId,
        subjectId: await this.encryption.hashForAudit(subjectId),
        reason: requestData.reason,
        requestedAt: new Date(),
        status: 'pending',
        specificDataRequested: requestData.specificData,
        keepAnonymizedData: requestData.keepAnonymized || true,
        ipAddress: await this.encryption.hashForAudit(context.ipAddress),
        userAgent: this.sanitizeUserAgent(context.userAgent)
      }
      
      await mongoConnection.getDatabase()
        .collection('data_erasure_requests')
        .insertOne(erasureRequest)
      
      // Traitement automatique si possible
      if (requestData.reason === 'consent_withdrawn') {
        await this.processAutomaticErasure(subjectId, requestId, requestData.keepAnonymized)
      }
      
      // Audit trail
      await this.logRGPDAction(
        subjectId,
        'data_deleted',
        'data_erasure',
        requestId,
        {
          legalBasis: 'legal_obligation',
          dataClassification: 'restricted',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          details: {
            reason: requestData.reason,
            keepAnonymized: requestData.keepAnonymized
          }
        }
      )
      
      this.logger.info('🗑️ Demande d\'effacement traitée', {
        requestId,
        reason: requestData.reason,
        keepAnonymized: requestData.keepAnonymized
      })
      
      return requestId
      
    } catch (error) {
      this.logger.error('❌ Erreur effacement données', { 
        subjectId, 
        error 
      })
      throw error
    }
  }
  
  // ===== DÉTECTION VIOLATIONS =====
  
  async detectAndNotifyBreach(
    breachData: {
      type: 'confidentiality' | 'integrity' | 'availability'
      severity: 'low' | 'medium' | 'high' | 'critical'
      description: string
      affectedRecords: number
      personalDataInvolved: string[]
      likelyConsequences: string
      measuresAdopted: string
    },
    context: {
      detectionSource: 'automated' | 'manual' | 'third_party'
      detectedBy: string
      detectedAt: Date
    }
  ): Promise<string> {
    try {
      const notificationId = crypto.randomUUID()
      
      const breach: BreachNotification = {
        id: notificationId,
        type: breachData.type,
        severity: breachData.severity,
        description: breachData.description,
        detectedAt: context.detectedAt,
        reportedToAuthorityAt: null,
        reportedToSubjectsAt: null,
        affectedDataSubjects: breachData.affectedRecords,
        personalDataCategories: breachData.personalDataInvolved,
        likelyConsequences: breachData.likelyConsequences,
        securityMeasures: breachData.measuresAdopted,
        status: 'detected',
        detectionSource: context.detectionSource,
        detectedBy: await this.encryption.hashForAudit(context.detectedBy),
        riskAssessment: this.calculateBreachRisk(breachData),
        requiresAuthorityNotification: this.requiresAuthorityNotification(breachData),
        requiresSubjectNotification: this.requiresSubjectNotification(breachData)
      }
      
      await this.breachCollection.insertOne(breach)
      
      // Notification automatique si critique
      if (breachData.severity === 'critical' || breachData.severity === 'high') {
        await this.initiateAutomaticBreachResponse(breach)
      }
      
      // Audit trail
      await this.logRGPDAction(
        context.detectedBy,
        'breach_detected',
        'security_breach',
        notificationId,
        {
          legalBasis: 'legal_obligation',
          dataClassification: 'restricted',
          ipAddress: '127.0.0.1', // Système interne
          userAgent: 'system',
          details: {
            type: breachData.type,
            severity: breachData.severity,
            affectedRecords: breachData.affectedRecords
          }
        }
      )
      
      this.logger.error('🚨 Violation RGPD détectée', {
        notificationId,
        type: breachData.type,
        severity: breachData.severity,
        affectedRecords: breachData.affectedRecords
      })
      
      return notificationId
      
    } catch (error) {
      this.logger.error('❌ Erreur notification violation', { error })
      throw error
    }
  }
  
  // ===== CONFORMITÉ ET REPORTING =====
  
  async generateComplianceReport(): Promise<RGPDCompliance> {
    try {
      // Audit de l'intégrité
      const integrityCheck = await this.validateAuditIntegrity(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 derniers jours
        new Date()
      )
      
      // Statistiques de consentement
      const consentStats = await this.getConsentMetrics()
      
      // Violations récentes
      const recentBreaches = await this.breachCollection
        .countDocuments({
          detectedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        })
      
      // Self-test du chiffrement
      const encryptionTest = await this.encryption.selfTest()
      
      return {
        reportGenerated: new Date().toISOString(),
        auditTrail: {
          integrityValid: integrityCheck.isValid,
          totalEntries: integrityCheck.totalEntries,
          validSignatures: integrityCheck.totalEntries - integrityCheck.corruptedSignatures,
          brokenChains: integrityCheck.brokenChains
        },
        consent: {
          totalConsents: consentStats.total,
          activeConsents: consentStats.byStatus.given || 0,
          withdrawalRate: consentStats.withdrawalRate,
          conversionRate: consentStats.conversionRate
        },
        dataProcessing: {
          recordsWithLegalBasis: await this.countProcessingRecordsWithBasis(),
          avgRetentionPeriod: await this.getAverageRetentionPeriod(),
          crossBorderTransfers: await this.countCrossBorderTransfers()
        },
        security: {
          encryptionFunctional: encryptionTest,
          recentBreaches,
          riskLevel: recentBreaches > 0 ? 'high' : 'low'
        },
        rights: {
          portabilityRequestsLast30Days: await this.countPortabilityRequests(30),
          erasureRequestsLast30Days: await this.countErasureRequests(30),
          averageResponseTime: await this.getAverageResponseTime()
        },
        compliance: {
          overallScore: this.calculateComplianceScore(integrityCheck, consentStats, recentBreaches),
          lastAudit: new Date().toISOString(),
          nextReview: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
        }
      }
      
    } catch (error) {
      this.logger.error('❌ Erreur génération rapport conformité', { error })
      throw error
    }
  }
  
  // ===== UTILITY FUNCTIONS =====
  
  private sanitizeUserAgent(userAgent: string): string {
    // Suppression des informations sensibles du User-Agent
    return userAgent
      .replace(/\b(?:Windows|Mac|Linux)\s+[^;)]+/gi, '[OS]')
      .replace(/\b\d+\.\d+(?:\.\d+)*\b/g, '[VERSION]')
      .substring(0, 200) // Limitation de taille
  }
  
  private async hasValidConsent(subjectId: string): Promise<boolean> {
    const hashedSubjectId = await this.encryption.hashForAudit(subjectId)
    
    const consent = await this.consentsCollection.findOne({
      subjectId: hashedSubjectId,
      status: 'given',
      expiresAt: { $gt: new Date() }
    })
    
    return consent !== null
  }
  
  private async processAutomaticErasure(
    subjectId: string,
    requestId: string,
    keepAnonymized = true
  ): Promise<void> {
    try {
      // Anonymisation des données élève
      const studentsCollection = mongoConnection.getDatabase().collection('students')
      
      if (keepAnonymized) {
        await studentsCollection.updateOne(
          { 'personalInfo.email': subjectId }, // Supposant que subjectId est l'email
          {
            $set: {
              'metadata.anonymized': true,
              'metadata.anonymizedAt': new Date(),
              'metadata.erasureRequestId': requestId
            },
            $unset: {
              personalInfo: 1
            }
          }
        )
      } else {
        await studentsCollection.deleteOne({
          'personalInfo.email': subjectId
        })
      }
      
      // Mise à jour du statut de la demande
      await mongoConnection.getDatabase()
        .collection('data_erasure_requests')
        .updateOne(
          { id: requestId },
          {
            $set: {
              status: 'completed',
              processedAt: new Date(),
              automaticProcessing: true
            }
          }
        )
      
    } catch (error) {
      this.logger.error('❌ Erreur effacement automatique', { 
        subjectId, 
        requestId, 
        error 
      })
      throw error
    }
  }
  
  private calculateBreachRisk(breachData: any): 'low' | 'medium' | 'high' | 'critical' {
    // Algorithme de calcul du risque basé sur plusieurs facteurs
    let riskScore = 0
    
    // Facteur type
    if (breachData.type === 'confidentiality') riskScore += 3
    else if (breachData.type === 'integrity') riskScore += 2
    else if (breachData.type === 'availability') riskScore += 1
    
    // Facteur volume
    if (breachData.affectedRecords > 1000) riskScore += 3
    else if (breachData.affectedRecords > 100) riskScore += 2
    else if (breachData.affectedRecords > 10) riskScore += 1
    
    // Facteur sensibilité des données
    const sensitiveCategories = ['personal_info', 'health', 'biometric', 'financial']
    const hasSensitiveData = breachData.personalDataInvolved.some(cat => 
      sensitiveCategories.includes(cat)
    )
    if (hasSensitiveData) riskScore += 2
    
    // Conversion en niveau
    if (riskScore >= 7) return 'critical'
    if (riskScore >= 5) return 'high'  
    if (riskScore >= 3) return 'medium'
    return 'low'
  }
  
  private requiresAuthorityNotification(breachData: any): boolean {
    // Notification obligatoire si risque élevé pour droits et libertés
    return breachData.severity === 'high' || breachData.severity === 'critical' ||
           breachData.affectedRecords > 100
  }
  
  private requiresSubjectNotification(breachData: any): boolean {
    // Notification aux personnes si risque élevé
    return breachData.severity === 'critical' ||
           (breachData.severity === 'high' && breachData.type === 'confidentiality')
  }
  
  private async initiateAutomaticBreachResponse(breach: BreachNotification): Promise<void> {
    try {
      // Actions automatiques en cas de violation critique
      this.logger.error('🚨 Réponse automatique violation critique', {
        notificationId: breach.id,
        type: breach.type,
        severity: breach.severity
      })
      
      // Ici, on pourrait implémenter :
      // - Notification automatique aux autorités
      // - Envoi d'emails aux personnes concernées
      // - Activation de mesures de sécurité supplémentaires
      // - Escalade vers l'équipe de sécurité
      
    } catch (error) {
      this.logger.error('❌ Erreur réponse automatique violation', { error })
    }
  }
  
  private async getConsentMetrics(): Promise<ConsentMetrics> {
    const stats = await this.consentsCollection.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray()
    
    const byStatus = stats.reduce((acc, stat) => {
      acc[stat._id] = stat.count
      return acc
    }, {})
    
    const total = Object.values(byStatus).reduce((sum: number, count: number) => sum + count, 0)
    
    return {
      total,
      byPurpose: {}, // Calcul plus complexe nécessaire
      byStatus,
      conversionRate: total > 0 ? (byStatus.given || 0) / total : 0,
      withdrawalRate: total > 0 ? (byStatus.withdrawn || 0) / total : 0,
      lastUpdated: new Date()
    }
  }
  
  private calculateComplianceScore(
    integrityCheck: any,
    consentStats: ConsentMetrics,
    recentBreaches: number
  ): number {
    let score = 100
    
    // Pénalités
    if (!integrityCheck.isValid) score -= 30
    if (integrityCheck.corruptedSignatures > 0) score -= 20
    if (consentStats.withdrawalRate > 0.3) score -= 15
    if (recentBreaches > 0) score -= 25
    
    return Math.max(0, score)
  }
  
  private async countProcessingRecordsWithBasis(): Promise<number> {
    return await this.processingCollection.countDocuments({
      legalBasis: { $exists: true, $ne: null }
    })
  }
  
  private async getAverageRetentionPeriod(): Promise<number> {
    const result = await this.processingCollection.aggregate([
      {
        $group: {
          _id: null,
          avgRetention: { $avg: '$retentionPeriod' }
        }
      }
    ]).toArray()
    
    return result[0]?.avgRetention || 0
  }
  
  private async countCrossBorderTransfers(): Promise<number> {
    return await this.processingCollection.countDocuments({
      crossBorderTransfers: true
    })
  }
  
  private async countPortabilityRequests(days: number): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return await mongoConnection.getDatabase()
      .collection('data_portability_requests')
      .countDocuments({
        requestedAt: { $gte: since }
      })
  }
  
  private async countErasureRequests(days: number): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return await mongoConnection.getDatabase()
      .collection('data_erasure_requests')
      .countDocuments({
        requestedAt: { $gte: since }
      })
  }
  
  private async getAverageResponseTime(): Promise<number> {
    // Calcul du temps de réponse moyen aux demandes RGPD
    const result = await mongoConnection.getDatabase()
      .collection('data_erasure_requests')
      .aggregate([
        {
          $match: {
            status: 'completed',
            processedAt: { $exists: true }
          }
        },
        {
          $addFields: {
            responseTime: {
              $subtract: ['$processedAt', '$requestedAt']
            }
          }
        },
        {
          $group: {
            _id: null,
            avgResponseTime: { $avg: '$responseTime' }
          }
        }
      ]).toArray()
    
    // Conversion en heures
    return result[0]?.avgResponseTime ? result[0].avgResponseTime / (1000 * 60 * 60) : 0
  }
}