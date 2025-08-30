// Types principaux pour MFR Education Automation v2.0

// === Types d'authentification ===

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  permissions: Permission[]
  profile: UserProfile
  createdAt: Date
  updatedAt: Date
  lastLogin?: Date
}

export type UserRole = 'admin' | 'teacher' | 'coordinator' | 'student' | 'parent'

export interface Permission {
  id: string
  name: string
  resource: string
  action: string
}

export interface UserProfile {
  avatar?: string
  phone?: string
  address?: Address
  preferences: UserPreferences
  mfr?: MFRInfo
}

export interface Address {
  street: string
  city: string
  postalCode: string
  country: string
}

export interface UserPreferences {
  language: 'fr' | 'en'
  theme: 'light' | 'dark' | 'auto'
  notifications: NotificationPreferences
  dashboard: DashboardPreferences
}

export interface NotificationPreferences {
  email: boolean
  push: boolean
  inApp: boolean
  frequency: 'immediate' | 'daily' | 'weekly'
}

export interface DashboardPreferences {
  widgets: string[]
  layout: 'compact' | 'comfortable' | 'spacious'
}

export interface MFRInfo {
  establishment: string
  department: string
  region: string
  subjects: string[]
  classes: string[]
}

// === Types d'authentification ===

export interface LoginCredentials {
  email: string
  password: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

// === Types de notification ===

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  persistent?: boolean
  timestamp: Date
  read: boolean
}

// === Types API ===

export interface APIConfig {
  baseURL: string
  version: string
  features: string[]
  limits: APILimits
}

export interface APILimits {
  maxRequestSize: number
  rateLimit: number
  maxUploadSize: number
}

export interface APIResponse<T = any> {
  data: T
  success: boolean
  message?: string
  errors?: APIError[]
  meta?: APIMeta
}

export interface APIError {
  code: string
  message: string
  field?: string
}

export interface APIMeta {
  page?: number
  limit?: number
  total?: number
  hasMore?: boolean
}

// === Types d'élèves ===

export interface StudentModel {
  _id?: string
  
  // Données personnelles chiffrées
  personalInfo: {
    firstName: string      // Chiffré AES-256
    lastName: string       // Chiffré AES-256
    email: string          // Chiffré AES-256
    dateOfBirth: Date      // Chiffré AES-256
    phone?: string         // Chiffré AES-256
    address?: Address      // Chiffré AES-256
  }
  
  // Identifiant anonymisé pour analytics RGPD
  anonymizedId: string     // Hash SHA-256
  
  // Données académiques
  academicData: {
    level: MFRLevel
    year: number
    startDate: Date
    expectedGraduation?: Date
    subjects: string[]
    learningDifficulties?: LearningDifficulty[]
    strengths?: string[]
    goals?: string[]
  }
  
  // Données familiales
  familyData?: {
    parents: ParentContact[]
    emergencyContact?: EmergencyContact
    socialSituation?: SocialSituation
  }
  
  // Progression optimisée pour agrégations
  progress: {
    overall: number        // 0-100
    bySubject: Map<string, number>
    byCompetency: Map<string, CompetencyLevel>
    lastUpdated: Date
    trend: ProgressTrend
    velocity: number       // Points/jour
    milestones: Milestone[]
  }
  
  // Activités et engagement
  engagement: {
    attendanceRate: number // 0-100
    participationScore: number // 0-100
    homeworkCompletionRate: number // 0-100
    classroomBehavior: BehaviorRating
    extracurricularActivities: string[]
  }
  
  // Métadonnées RGPD
  metadata: {
    createdAt: Date
    updatedAt: Date
    dataRetentionUntil: Date // TTL automatique
    consentGiven: boolean
    consentDate: Date
    lastActivity: Date
    anonymized?: boolean
    anonymizedAt?: Date
  }
}

export type MFRLevel = 
  | 'CAPA_1ere' 
  | 'CAPA_2eme' 
  | 'CAPA_3eme' 
  | 'BAC_PRO_1ere' 
  | 'BAC_PRO_2eme' 
  | 'BAC_PRO_3eme'
  | 'BTS_1ere'
  | 'BTS_2eme'

export interface LearningDifficulty {
  type: 'dyslexia' | 'dyscalculia' | 'attention' | 'memory' | 'other'
  severity: 'mild' | 'moderate' | 'severe'
  accommodations: string[]
  diagnosis?: {
    date: Date
    professional: string
    official: boolean
  }
}

export interface ParentContact {
  id: string
  relationship: 'father' | 'mother' | 'guardian' | 'other'
  firstName: string      // Chiffré
  lastName: string       // Chiffré
  email: string          // Chiffré
  phone: string          // Chiffré
  address?: Address      // Chiffré
  profession?: string
  isEmergencyContact: boolean
  isPrimary: boolean
}

export interface EmergencyContact {
  name: string           // Chiffré
  relationship: string
  phone: string          // Chiffré
  email?: string         // Chiffré
}

export interface SocialSituation {
  familySize: number
  parentsMaritalStatus: string
  householdIncome?: 'low' | 'medium' | 'high' | 'not_specified'
  specialNeeds?: string[]
  supportServices?: string[]
}

export type ProgressTrend = 'improving' | 'stable' | 'declining'

export type CompetencyLevel = 'novice' | 'developing' | 'proficient' | 'advanced'

export interface Milestone {
  id: string
  name: string
  description: string
  targetDate: Date
  achievedDate?: Date
  status: 'pending' | 'in_progress' | 'completed' | 'overdue'
  category: 'academic' | 'personal' | 'professional'
}

export type BehaviorRating = 'excellent' | 'good' | 'satisfactory' | 'needs_improvement' | 'concerning'

// === Types de contenu ===

export interface ContentModel {
  _id?: string
  type: ContentType
  title: string
  description: string
  content: ContentBody
  
  // Méta-informations pédagogiques
  pedagogical: {
    subject: string
    level: MFRLevel[]
    difficulty: DifficultyLevel
    duration: number      // minutes
    objectives: string[]
    prerequisites: string[]
    competencies: string[]
    bloomTaxonomy: BloomLevel[]
  }
  
  // Génération IA
  aiGeneration?: {
    agentUsed: string
    prompt: string
    generatedAt: Date
    cost: number
    quality: number
    reviewStatus: 'pending' | 'approved' | 'rejected'
    reviewNotes?: string
  }
  
  // Analytics d'usage
  usage: {
    accessCount: number
    averageRating: number
    completionRate: number
    effectivenessScore?: number
    studentFeedback: ContentFeedback[]
  }
  
  // Méta-données
  metadata: {
    createdAt: Date
    updatedAt: Date
    createdBy: string
    version: string
    tags: string[]
    language: string
    status: ContentStatus
  }
}

export type ContentType = 
  | 'lesson' 
  | 'exercise' 
  | 'assessment' 
  | 'resource' 
  | 'gamified_activity'
  | 'project'
  | 'tutorial'

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert'

export type BloomLevel = 
  | 'remember' 
  | 'understand' 
  | 'apply' 
  | 'analyze' 
  | 'evaluate' 
  | 'create'

export interface ContentBody {
  introduction?: string
  sections: ContentSection[]
  conclusion?: string
  resources?: ContentResource[]
  interactiveElements?: InteractiveElement[]
}

export interface ContentSection {
  id: string
  title: string
  content: string
  media?: MediaItem[]
  exercises?: Exercise[]
}

export interface ContentResource {
  type: 'link' | 'document' | 'video' | 'audio' | 'image'
  title: string
  url: string
  description?: string
}

export interface MediaItem {
  type: 'image' | 'video' | 'audio' | 'document'
  url: string
  caption?: string
  altText?: string
}

export interface Exercise {
  id: string
  type: ExerciseType
  question: string
  options?: string[]
  correctAnswer: string | string[]
  explanation?: string
  hints?: string[]
  points: number
}

export type ExerciseType = 
  | 'multiple_choice' 
  | 'single_choice'
  | 'text_input' 
  | 'drag_drop'
  | 'matching'
  | 'ordering'

export interface InteractiveElement {
  type: 'quiz' | 'simulation' | 'game' | 'poll' | 'discussion'
  id: string
  config: Record<string, any>
}

export interface ContentFeedback {
  studentId: string
  rating: number        // 1-5
  comment?: string
  helpful: boolean
  completedAt: Date
}

export type ContentStatus = 'draft' | 'review' | 'published' | 'archived'

// === Types d'audit ===

export interface AuditLogModel {
  _id?: string
  timestamp: Date
  
  // Identifiants pseudonymisés
  userId: string
  sessionId?: string
  
  // Action et ressource
  action: string
  resourceType: string
  resourceId: string
  
  // Contexte technique
  ipAddress: string      // Hashé
  userAgent: string      // Sanitisé
  endpoint?: string
  method?: string
  
  // Résultat
  success: boolean
  statusCode?: number
  errorCode?: string
  errorMessage?: string
  
  // Conformité RGPD
  legalBasis: string
  dataClassification: DataClassification
  retentionPeriod: number
  
  // Métadonnées
  metadata?: Record<string, any>
  
  // Signature cryptographique pour immutabilité
  signature: string
}

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted'

// === Types IA ===

export interface AIRequest {
  type: string
  prompt: string
  parameters?: Record<string, any>
  maxTokens?: number
  temperature?: number
  qualityLevel?: 'basic' | 'standard' | 'high'
  useCache?: boolean
  cacheKey?: string
  timestamp?: Date
}

export interface AIResponse {
  content: string
  agent?: string
  tokensUsed: number
  cost: number
  quality: number
  executionTime?: number
  timestamp?: Date
}

export interface ContentGenerationRequest extends AIRequest {
  studentId?: string
  subject: string
  level: MFRLevel
  contentType: ContentType
}

export interface CostOptimization {
  selectedAgent: string
  maxTokens: number
  temperature: number
  useCache: boolean
  qualityLevel: 'basic' | 'standard' | 'high'
  priority: 'cost' | 'balanced' | 'quality'
  estimatedCost: number
  reasoning: string
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface AIAgent {
  name: string
  capabilities: string[]
  costPerToken: number
  maxTokens: number
  quality: number
  reliability: number
}

// === Types de base de données ===

export interface DatabaseConfig {
  uri: string
  dbName: string
  maxPoolSize: number
  timeout: number
}

export interface AnalyticsQuery {
  classId?: string
  timeframe?: 'day' | 'week' | 'month' | 'year'
  metrics: string[]
  filters?: Record<string, any>
}

// === Exports groupés ===

export * from './ai'
export * from './database'
export * from './monitoring'
export * from './security'