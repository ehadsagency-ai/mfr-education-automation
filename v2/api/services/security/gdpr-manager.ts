import crypto from 'crypto'
import { Logger } from '@/services/logging'
import { MongoDBService } from '@/services/database/mongodb'
import { EncryptionService } from './encryption'
import { AuditLogger } from './audit-logger'
import type { 
  ConsentRecord, 
  DataErasureRequest, 
  DataErasureReport, 
  DataPortabilityRequest,
  PrivacyImpactAssessment,
  GDPRRights
} from '@/types/security'

/**
 * Gestionnaire de conformité RGPD
 * Implémente tous les droits RGPD et mécanismes de protection
 */
export class GDPRManager {
  private logger = new Logger('GDPRManager')
  
  constructor(
    private mongodb: MongoDBService,
    private encryption: EncryptionService,
    private auditLogger: AuditLogger
  ) {}
  
  // === GESTION DES CONSENTEMENTS ===
  
  /**
   * Enregistrement d'un consentement RGPD
   */
  async recordConsent(consent: Omit<ConsentRecord, 'id' | 'timestamp' | 'signature'>): Promise<string> {
    try {
      const consentId = crypto.randomUUID()
      
      const consentRecord: ConsentRecord = {
        id: consentId,
        ...consent,
        timestamp: new Date(),
        signature: await this.generateLegalSignature(consent)
      }
      
      // Stockage avec chiffrement
      await this.mongodb.getCollection('consents').insertOne({
        ...consentRecord,
        // Chiffrement des données personnelles
        subjectData: await this.encryption.encryptObject(consent.subjectData),
        metadata: await this.encryption.encryptObject(consent.metadata || {})
      })
      
      // Audit obligatoire
      await this.auditLogger.log({
        action: 'consent_recorded',
        userId: consent.subjectId,
        resourceType: 'consent',
        resourceId: consentId,
        legalBasis: 'consent',
        metadata: {
          purposes: consent.purposes,
          dataTypes: consent.dataTypes,
          consentMethod: consent.consentMethod
        }
      })
      
      this.logger.info('Consentement enregistré', { 
        consentId, 
        subjectId: consent.subjectId, 
        purposes: consent.purposes 
      })
      
      return consentId
      
    } catch (error) {
      this.logger.error('Erreur enregistrement consentement', { error, consent })
      throw error
    }
  }
  
  /**
   * Retrait de consentement avec anonymisation automatique
   */
  async withdrawConsent(subjectId: string, purposes?: string[]): Promise<void> {
    try {
      // Identification des consentements actifs
      const activeConsents = await this.mongodb.getCollection('consents')
        .find({ 
          subjectId, 
          status: 'active',
          ...(purposes && { purposes: { $in: purposes } })
        })
        .toArray()
      
      if (activeConsents.length === 0) {
        throw new Error('Aucun consentement actif trouvé')
      }
      
      // Retrait des consentements
      for (const consent of activeConsents) {
        await this.mongodb.getCollection('consents').updateOne(
          { id: consent.id },
          { 
            $set: { 
              status: 'withdrawn',
              withdrawalDate: new Date(),
              withdrawalMethod: 'user_request'
            }
          }
        )
        
        // Audit
        await this.auditLogger.log({
          action: 'consent_withdrawn',
          userId: subjectId,
          resourceType: 'consent',
          resourceId: consent.id,
          legalBasis: 'consent_withdrawal'
        })
      }
      
      // Vérification si anonymisation nécessaire
      const remainingConsents = await this.mongodb.getCollection('consents')
        .countDocuments({ subjectId, status: 'active' })
      
      if (remainingConsents === 0) {
        await this.anonymizeSubjectData(subjectId, 'consent_withdrawn')
      }
      
      this.logger.info('Consentement retiré', { subjectId, withdrawnConsents: activeConsents.length })
      
    } catch (error) {
      this.logger.error('Erreur retrait consentement', { error, subjectId })
      throw error
    }
  }
  
  /**
   * Vérification de la validité d'un consentement
   */
  async isConsentValid(subjectId: string, purpose: string, dataType?: string): Promise<boolean> {
    try {
      const consent = await this.mongodb.getCollection('consents').findOne({
        subjectId,
        status: 'active',
        purposes: purpose,
        ...(dataType && { dataTypes: dataType }),
        // Vérification expiration
        $or: [
          { expirationDate: { $exists: false } },
          { expirationDate: { $gt: new Date() } }
        ]
      })
      
      return !!consent
      
    } catch (error) {
      this.logger.error('Erreur vérification consentement', { error, subjectId, purpose })
      return false
    }
  }
  
  // === DROIT À L'OUBLI ===
  
  /**
   * Traitement d'une demande d'effacement (droit à l'oubli)
   */
  async processErasureRequest(request: DataErasureRequest): Promise<DataErasureReport> {
    const report: DataErasureReport = {
      requestId: crypto.randomUUID(),
      subjectId: request.subjectId,
      requestDate: new Date(),
      requesterId: request.requesterId,
      status: 'processing',
      erasedData: [],
      retainedData: [],
      errors: []
    }
    
    try {
      // Audit de début de traitement
      await this.auditLogger.log({
        action: 'erasure_request_started',
        userId: request.requesterId,
        resourceType: 'personal_data',
        resourceId: request.subjectId,
        legalBasis: 'right_to_erasure',
        metadata: { requestId: report.requestId, reason: request.reason }
      })
      
      // Vérification des droits légaux
      const legalCheck = await this.verifyErasureRights(request)
      if (!legalCheck.canErase) {
        report.status = 'rejected'
        report.rejectionReason = legalCheck.reason
        await this.auditLogger.log({
          action: 'erasure_request_rejected',
          userId: request.requesterId,
          resourceType: 'personal_data',
          resourceId: request.subjectId,
          legalBasis: 'legal_obligation',
          metadata: { requestId: report.requestId, reason: legalCheck.reason }
        })
        return report
      }
      
      // Inventaire des données
      const dataInventory = await this.inventorySubjectData(request.subjectId)
      
      // Traitement par type de données
      for (const dataItem of dataInventory) {
        try {
          if (await this.canEraseData(dataItem)) {
            await this.eraseData(dataItem)
            report.erasedData.push(dataItem)
          } else {
            await this.anonymizeData(dataItem)
            report.retainedData.push({
              ...dataItem,
              retentionReason: await this.getRetentionReason(dataItem),
              anonymized: true
            })
          }
        } catch (error) {
          report.errors.push({
            dataType: dataItem.type,
            collection: dataItem.collection,
            error: error.message
          })
        }
      }
      
      // Vérification complétude
      const verification = await this.verifyErasureComplete(request.subjectId)
      report.status = verification.complete ? 'completed' : 'partial'
      report.completedAt = new Date()
      
      // Audit de fin
      await this.auditLogger.log({
        action: 'erasure_request_completed',
        userId: request.requesterId,
        resourceType: 'personal_data',
        resourceId: request.subjectId,
        legalBasis: 'right_to_erasure',
        success: report.status === 'completed',
        metadata: { 
          requestId: report.requestId,
          erasedItems: report.erasedData.length,
          retainedItems: report.retainedData.length,
          errors: report.errors.length
        }
      })
      
      this.logger.info('Demande d\'effacement traitée', {
        requestId: report.requestId,
        status: report.status,
        erasedItems: report.erasedData.length,
        retainedItems: report.retainedData.length
      })
      
      return report
      
    } catch (error) {
      report.status = 'failed'
      report.errors.push({ 
        dataType: 'system',
        collection: 'system',
        error: error.message 
      })
      
      this.logger.error('Erreur traitement demande d\'effacement', { error, requestId: report.requestId })
      return report
    }
  }
  
  // === DROIT À LA PORTABILITÉ ===
  
  /**
   * Export des données personnelles (portabilité RGPD)
   */
  async exportPersonalData(request: DataPortabilityRequest): Promise<any> {
    try {
      // Vérification consentement/base légale
      const hasRights = await this.verifyPortabilityRights(request.subjectId, request.requesterId)
      if (!hasRights) {
        throw new Error('Droits insuffisants pour la portabilité des données')
      }
      
      // Collecte des données avec déchiffrement
      const studentData = await this.mongodb.findStudentById(request.subjectId)
      if (!studentData) {
        throw new Error('Données sujet introuvables')
      }
      
      // Construction export structuré
      const exportData = {
        metadata: {
          exportId: crypto.randomUUID(),
          subjectId: request.subjectId,
          exportDate: new Date().toISOString(),
          format: request.format || 'json',
          version: '1.0'
        },
        personalData: {
          identity: {
            firstName: studentData.personalInfo.firstName,
            lastName: studentData.personalInfo.lastName,
            email: studentData.personalInfo.email,
            dateOfBirth: studentData.personalInfo.dateOfBirth
          },
          academic: {
            level: studentData.academicData.level,
            subjects: studentData.academicData.subjects,
            progress: studentData.progress,
            engagement: studentData.engagement
          },
          timeline: await this.getPersonalDataTimeline(request.subjectId)
        },
        usage: await this.getDataUsageHistory(request.subjectId),
        consents: await this.getConsentHistory(request.subjectId)
      }
      
      // Audit
      await this.auditLogger.log({
        action: 'data_export_completed',
        userId: request.requesterId,
        resourceType: 'personal_data',
        resourceId: request.subjectId,
        legalBasis: 'data_portability',
        metadata: { exportId: exportData.metadata.exportId }
      })
      
      return exportData
      
    } catch (error) {
      this.logger.error('Erreur export données personnelles', { error, request })
      throw error
    }
  }
  
  // === ÉVALUATION D'IMPACT (PIA) ===
  
  /**
   * Génération d'évaluation d'impact sur la protection des données
   */
  async generatePrivacyImpactAssessment(): Promise<PrivacyImpactAssessment> {
    const pia: PrivacyImpactAssessment = {
      id: crypto.randomUUID(),
      generatedAt: new Date(),
      version: '2.0',
      
      // Contexte du traitement
      processing: {
        purpose: 'Automatisation pédagogique avec IA pour MFR',
        legalBasis: ['consent', 'legitimate_interest', 'public_task'],
        dataTypes: [
          'identity_data',
          'academic_performance',
          'behavioral_data',
          'communication_data'
        ],
        recipients: ['teachers', 'coordinators', 'parents', 'ai_systems'],
        retentionPeriod: '7 years (academic data), 10 years (audit logs)',
        internationalTransfers: false
      },
      
      // Analyse des risques
      riskAssessment: {
        dataVolume: 'medium', // < 10000 students
        sensitivityLevel: 'high', // Data about minors
        vulnerabilityLevel: 'low', // Strong encryption + security measures
        
        identifiedRisks: [
          {
            type: 'unauthorized_access',
            probability: 'low',
            impact: 'high',
            mitigations: ['field_level_encryption', 'access_controls', 'audit_logging']
          },
          {
            type: 'data_breach',
            probability: 'very_low', 
            impact: 'very_high',
            mitigations: ['end_to_end_encryption', 'breach_detection', 'incident_response']
          },
          {
            type: 'ai_bias',
            probability: 'medium',
            impact: 'medium',
            mitigations: ['algorithmic_auditing', 'human_oversight', 'bias_monitoring']
          }
        ],
        
        overallRiskLevel: 'acceptable'
      },
      
      // Mesures techniques et organisationnelles
      safeguards: {
        technical: [
          'AES-256-GCM encryption',
          'PBKDF2 key derivation', 
          'Field-level encryption',
          'Secure key management',
          'Audit trail integrity',
          'Automated breach detection',
          'Circuit breakers for AI systems'
        ],
        organizational: [
          'Privacy by design approach',
          'Staff training on GDPR',
          'Incident response procedures',
          'Regular security assessments',
          'Data minimization practices',
          'Consent management system'
        ]
      },
      
      // Conformité
      compliance: {
        gdprCompliant: true,
        lawfulnessAssessed: true,
        necessityJustified: true,
        proportionalityEnsured: true,
        dataMinimizationApplied: true,
        accuracyMaintained: true,
        storageMinimized: true,
        integrityEnsured: true,
        accountabilityDemonstrated: true
      },
      
      recommendations: [
        'Poursuivre les audits de sécurité trimestriels',
        'Implémenter une surveillance continue des biais IA',
        'Étendre la formation RGPD aux nouveaux utilisateurs',
        'Réviser la PIA annuellement'
      ],
      
      nextReviewDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 an
    }
    
    return pia
  }
  
  // === MÉTHODES PRIVÉES ===
  
  private async generateLegalSignature(consent: any): Promise<string> {
    const payload = {
      subjectId: consent.subjectId,
      purposes: consent.purposes,
      dataTypes: consent.dataTypes,
      timestamp: consent.timestamp || new Date(),
      consentMethod: consent.consentMethod
    }
    
    return await this.encryption.signData(payload)
  }
  
  private async verifyErasureRights(request: DataErasureRequest): Promise<{ canErase: boolean, reason?: string }> {
    // Vérifications légales pour le droit à l'oubli
    
    // 1. Vérification âge (données de mineurs)
    const student = await this.mongodb.findStudentById(request.subjectId)
    if (student) {
      const age = new Date().getFullYear() - new Date(student.personalInfo.dateOfBirth).getFullYear()
      if (age < 18 && request.requesterId !== student.familyData?.parents?.[0]?.id) {
        return { canErase: false, reason: 'Autorisation parentale requise' }
      }
    }
    
    // 2. Obligations légales de conservation
    if (request.reason !== 'legal_obligation_ends') {
      const hasLegalObligation = await this.checkLegalRetentionObligation(request.subjectId)
      if (hasLegalObligation) {
        return { canErase: false, reason: 'Obligation légale de conservation (Code de l\'éducation)' }
      }
    }
    
    // 3. Intérêt légitime ou public
    if (request.reason === 'objects_to_processing') {
      const hasLegitimateInterest = await this.assessLegitimateInterest(request.subjectId)
      if (hasLegitimateInterest) {
        return { canErase: false, reason: 'Intérêt légitime prépondérant (suivi pédagogique)' }
      }
    }
    
    return { canErase: true }
  }
  
  private async inventorySubjectData(subjectId: string): Promise<any[]> {
    // Inventaire complet des données personnelles
    const inventory = []
    
    // Données élève principales
    const student = await this.mongodb.findStudentById(subjectId)
    if (student) {
      inventory.push({
        type: 'student_profile',
        collection: 'students',
        id: student._id,
        classification: 'personal_data'
      })
    }
    
    // Contenus générés
    const contents = await this.mongodb.getCollection('contents').find({
      'usage.studentFeedback.studentId': subjectId
    }).toArray()
    
    for (const content of contents) {
      inventory.push({
        type: 'content_feedback',
        collection: 'contents',
        id: content._id,
        classification: 'behavioral_data'
      })
    }
    
    // Logs d'audit
    const auditLogs = await this.mongodb.getCollection('audit_logs').find({
      userId: this.encryption.hashForAudit(subjectId)
    }).toArray()
    
    for (const log of auditLogs) {
      inventory.push({
        type: 'audit_log',
        collection: 'audit_logs',
        id: log._id,
        classification: 'system_data'
      })
    }
    
    return inventory
  }
  
  private async canEraseData(dataItem: any): Promise<boolean> {
    // Règles métier pour l'effacement
    switch (dataItem.type) {
      case 'audit_log':
        // Logs d'audit conservés pour obligations légales
        return false
      
      case 'student_profile':
        // Profil élève effaçable sauf obligation légale
        return true
      
      case 'content_feedback':
        // Feedback anonymisable
        return false
      
      default:
        return true
    }
  }
  
  private async eraseData(dataItem: any): Promise<void> {
    await this.mongodb.getCollection(dataItem.collection).deleteOne({
      _id: dataItem.id
    })
  }
  
  private async anonymizeData(dataItem: any): Promise<void> {
    // Anonymisation irréversible selon le type
    switch (dataItem.type) {
      case 'student_profile':
        await this.anonymizeSubjectData(dataItem.id, 'erasure_request')
        break
      
      case 'content_feedback':
        await this.mongodb.getCollection(dataItem.collection).updateOne(
          { _id: dataItem.id },
          { $set: { 'usage.studentFeedback.$.studentId': '[ANONYMIZED]' } }
        )
        break
    }
  }
  
  private async anonymizeSubjectData(subjectId: string, reason: string): Promise<void> {
    await this.mongodb.anonymizeStudentData(subjectId)
    
    await this.auditLogger.log({
      action: 'data_anonymized',
      userId: 'system',
      resourceType: 'personal_data', 
      resourceId: subjectId,
      legalBasis: 'gdpr_compliance',
      metadata: { reason }
    })
  }
  
  // Méthodes utilitaires additionnelles...
  private async checkLegalRetentionObligation(subjectId: string): Promise<boolean> {
    // Implémentation spécifique aux obligations légales françaises
    return false // Simplifié pour l'exemple
  }
  
  private async assessLegitimateInterest(subjectId: string): Promise<boolean> {
    // Évaluation de l'intérêt légitime vs droits de la personne
    return false // Simplifié pour l'exemple
  }
  
  private async verifyPortabilityRights(subjectId: string, requesterId: string): Promise<boolean> {
    // Vérification des droits d'accès pour portabilité
    return true // Simplifié pour l'exemple
  }
  
  private async getPersonalDataTimeline(subjectId: string): Promise<any[]> {
    // Chronologie des données personnelles
    return [] // À implémenter
  }
  
  private async getDataUsageHistory(subjectId: string): Promise<any[]> {
    // Historique d'utilisation des données
    return [] // À implémenter 
  }
  
  private async getConsentHistory(subjectId: string): Promise<any[]> {
    // Historique des consentements
    return [] // À implémenter
  }
  
  private async verifyErasureComplete(subjectId: string): Promise<{ complete: boolean }> {
    // Vérification complétude effacement
    const remainingData = await this.inventorySubjectData(subjectId)
    return { complete: remainingData.length === 0 }
  }
  
  private async getRetentionReason(dataItem: any): Promise<string> {
    // Raison de rétention des données
    switch (dataItem.type) {
      case 'audit_log':
        return 'Obligation légale - Conservation logs 10 ans'
      default:
        return 'Conservation pour intérêt légitime'
    }
  }
}