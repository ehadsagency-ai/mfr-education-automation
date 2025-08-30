import { Anthropic } from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { 
  AIRequest, 
  AIResponse, 
  AIAgent, 
  ContentGenerationRequest,
  CostOptimization,
  CircuitBreakerState
} from '@/types/ai'
import { Logger } from '@/services/logging'
import { CostOptimizer } from './cost-optimizer'
import { CircuitBreaker } from './circuit-breaker'
import { CacheManager } from './cache-manager'
import { MetricsCollector } from '@/services/monitoring'

export class AIOrchestrator {
  private logger = new Logger('AIOrchestrator')
  private costOptimizer = new CostOptimizer()
  private cacheManager = new CacheManager()
  private metricsCollector = new MetricsCollector()
  
  // Agents IA
  private claude: Anthropic
  private openai: OpenAI
  private gemini: GoogleGenerativeAI
  
  // Circuit breakers pour chaque agent
  private circuitBreakers = new Map<string, CircuitBreaker>()
  
  // Configuration des agents
  private agentCapabilities = {
    claude: {
      strengths: ['pedagogical_analysis', 'empathic_feedback', 'complex_reasoning'],
      costPerToken: 0.000015, // Exemple de tarif
      maxTokens: 4096,
      quality: 0.95,
      reliability: 0.98
    },
    openai: {
      strengths: ['creative_content', 'gamification', 'visual_descriptions'],
      costPerToken: 0.000010,
      maxTokens: 4096,
      quality: 0.90,
      reliability: 0.96
    },
    deepseek: {
      strengths: ['technical_optimization', 'code_analysis', 'cost_efficiency'],
      costPerToken: 0.000002,
      maxTokens: 2048,
      quality: 0.80,
      reliability: 0.92
    },
    gemini: {
      strengths: ['fact_checking', 'research', 'multilingual'],
      costPerToken: 0.000005,
      maxTokens: 2048,
      quality: 0.85,
      reliability: 0.94
    }
  }
  
  constructor() {
    this.initializeAgents()
    this.initializeCircuitBreakers()
  }
  
  private initializeAgents(): void {
    this.claude = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY!
    })
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!
    })
    
    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  
  private initializeCircuitBreakers(): void {
    Object.keys(this.agentCapabilities).forEach(agentName => {
      this.circuitBreakers.set(agentName, new CircuitBreaker({
        failureThreshold: 5,
        recoveryTimeout: 30000,
        monitoringPeriod: 60000
      }))
    })
  }
  
  async generateContent(request: ContentGenerationRequest): Promise<AIResponse> {
    const startTime = Date.now()
    
    try {
      // 1. Optimisation des coûts et sélection d'agent
      const optimizedRequest = await this.optimizeRequest(request)
      
      // 2. Vérification du cache
      const cachedResponse = await this.cacheManager.get(optimizedRequest)
      if (cachedResponse) {
        this.logger.info('Cache hit for AI request', { 
          requestType: request.type,
          cacheKey: optimizedRequest.cacheKey 
        })
        return cachedResponse
      }
      
      // 3. Sélection de l'agent optimal
      const selectedAgent = this.selectOptimalAgent(optimizedRequest)
      
      // 4. Exécution avec fallback automatique
      const response = await this.executeWithFallback(selectedAgent, optimizedRequest)
      
      // 5. Mise en cache de la réponse
      await this.cacheManager.set(optimizedRequest, response)
      
      // 6. Collecte des métriques
      await this.collectMetrics(request, response, selectedAgent, Date.now() - startTime)
      
      return response
      
    } catch (error) {
      this.logger.error('Erreur génération contenu IA', { error, request })
      
      // Métriques d'erreur
      await this.metricsCollector.recordError('ai_generation_failed', {
        requestType: request.type,
        error: error.message
      })
      
      throw error
    }
  }
  
  private async optimizeRequest(request: ContentGenerationRequest): Promise<AIRequest> {
    // Optimisation intelligente du budget
    const costOptimization = await this.costOptimizer.optimize(request)
    
    return {
      ...request,
      ...costOptimization,
      cacheKey: this.generateCacheKey(request),
      timestamp: new Date()
    }
  }
  
  private selectOptimalAgent(request: AIRequest): string {
    // Matrice de décision multi-critères
    const scores = Object.entries(this.agentCapabilities).map(([agentName, capabilities]) => {
      let score = 0
      
      // Score de spécialisation (40%)
      const specializationScore = this.calculateSpecializationScore(request.type, capabilities.strengths)
      score += specializationScore * 0.4
      
      // Score de qualité (30%)
      const qualityScore = capabilities.quality
      score += qualityScore * 0.3
      
      // Score de coût (20%) - inversé car moins cher = mieux
      const costScore = 1 - (capabilities.costPerToken / 0.000015)
      score += costScore * 0.2
      
      // Score de fiabilité (10%)
      const reliabilityScore = capabilities.reliability
      score += reliabilityScore * 0.1
      
      // Pénalité si circuit breaker ouvert
      const circuitBreaker = this.circuitBreakers.get(agentName)
      if (circuitBreaker?.getState() === 'OPEN') {
        score *= 0.1
      }
      
      return { agentName, score, capabilities }
    })
    
    // Tri par score décroissant
    scores.sort((a, b) => b.score - a.score)
    
    const selectedAgent = scores[0].agentName
    
    this.logger.info('Agent sélectionné', {
      selectedAgent,
      scores: scores.map(s => ({ agent: s.agentName, score: s.score })),
      requestType: request.type
    })
    
    return selectedAgent
  }
  
  private calculateSpecializationScore(requestType: string, strengths: string[]): number {
    // Correspondance entre types de requête et forces des agents
    const typeStrengthMap: Record<string, string[]> = {
      'pedagogical_analysis': ['pedagogical_analysis', 'empathic_feedback'],
      'creative_content': ['creative_content', 'gamification'],
      'technical_content': ['technical_optimization', 'code_analysis'],
      'research': ['fact_checking', 'research'],
      'feedback': ['empathic_feedback', 'pedagogical_analysis'],
      'gamified_exercise': ['creative_content', 'gamification']
    }
    
    const relevantStrengths = typeStrengthMap[requestType] || []
    const matches = strengths.filter(s => relevantStrengths.includes(s)).length
    
    return matches / Math.max(relevantStrengths.length, 1)
  }
  
  private async executeWithFallback(primaryAgent: string, request: AIRequest): Promise<AIResponse> {
    const fallbackOrder = this.getFallbackOrder(primaryAgent, request)
    
    for (const agentName of fallbackOrder) {
      try {
        const circuitBreaker = this.circuitBreakers.get(agentName)!
        
        return await circuitBreaker.execute(async () => {
          return await this.executeAgentRequest(agentName, request)
        })
        
      } catch (error) {
        this.logger.warn(`Agent ${agentName} failed, trying fallback`, { error })
        
        // Si c'est le dernier agent, on relance l'erreur
        if (agentName === fallbackOrder[fallbackOrder.length - 1]) {
          throw error
        }
      }
    }
    
    throw new Error('Tous les agents IA ont échoué')
  }
  
  private getFallbackOrder(primaryAgent: string, request: AIRequest): string[] {
    const allAgents = Object.keys(this.agentCapabilities)
    const fallbackOrder = [primaryAgent]
    
    // Ajout des agents de fallback par ordre de préférence
    const remainingAgents = allAgents.filter(a => a !== primaryAgent)
    
    // Priorisation selon le contexte
    if (request.qualityLevel === 'high') {
      // Pour haute qualité, privilégier Claude et OpenAI
      fallbackOrder.push(...remainingAgents.filter(a => ['claude', 'openai'].includes(a)))
      fallbackOrder.push(...remainingAgents.filter(a => !['claude', 'openai'].includes(a)))
    } else {
      // Pour coût optimisé, privilégier les agents moins chers
      fallbackOrder.push(...remainingAgents.filter(a => ['deepseek', 'gemini'].includes(a)))
      fallbackOrder.push(...remainingAgents.filter(a => !['deepseek', 'gemini'].includes(a)))
    }
    
    return [...new Set(fallbackOrder)] // Suppression des doublons
  }
  
  private async executeAgentRequest(agentName: string, request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now()
    
    try {
      let response: AIResponse
      
      switch (agentName) {
        case 'claude':
          response = await this.executeClaude(request)
          break
        case 'openai':
          response = await this.executeOpenAI(request)
          break
        case 'deepseek':
          response = await this.executeDeepSeek(request)
          break
        case 'gemini':
          response = await this.executeGemini(request)
          break
        default:
          throw new Error(`Agent inconnu: ${agentName}`)
      }
      
      const executionTime = Date.now() - startTime
      
      return {
        ...response,
        agent: agentName,
        executionTime,
        timestamp: new Date()
      }
      
    } catch (error) {
      this.logger.error(`Erreur exécution agent ${agentName}`, { error, request })
      throw error
    }
  }
  
  private async executeClaude(request: AIRequest): Promise<AIResponse> {
    const response = await this.claude.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature || 0.7,
      messages: [
        {
          role: 'user',
          content: this.buildPrompt(request)
        }
      ]
    })
    
    return {
      content: response.content[0].text,
      tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
      cost: this.calculateCost('claude', response.usage?.input_tokens + response.usage?.output_tokens || 0),
      quality: this.agentCapabilities.claude.quality
    }
  }
  
  private async executeOpenAI(request: AIRequest): Promise<AIResponse> {
    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature || 0.7,
      messages: [
        {
          role: 'user',
          content: this.buildPrompt(request)
        }
      ]
    })
    
    const tokensUsed = response.usage?.total_tokens || 0
    
    return {
      content: response.choices[0].message.content || '',
      tokensUsed,
      cost: this.calculateCost('openai', tokensUsed),
      quality: this.agentCapabilities.openai.quality
    }
  }
  
  private async executeDeepSeek(request: AIRequest): Promise<AIResponse> {
    // TODO: Implémenter DeepSeek API
    throw new Error('DeepSeek not implemented yet')
  }
  
  private async executeGemini(request: AIRequest): Promise<AIResponse> {
    const model = this.gemini.getGenerativeModel({ 
      model: process.env.GEMINI_MODEL || 'gemini-pro' 
    })
    
    const response = await model.generateContent(this.buildPrompt(request))
    const result = await response.response
    
    return {
      content: result.text(),
      tokensUsed: 0, // Gemini ne fournit pas toujours cette info
      cost: this.calculateCost('gemini', 0),
      quality: this.agentCapabilities.gemini.quality
    }
  }
  
  private buildPrompt(request: AIRequest): string {
    // Construction du prompt optimisé selon le type de requête
    let prompt = request.prompt
    
    // Ajout de contexte spécifique selon le type
    if (request.type === 'pedagogical_analysis') {
      prompt = `En tant qu'expert pédagogique en MFR, ${prompt}`
    } else if (request.type === 'creative_content') {
      prompt = `Créez un contenu engageant et créatif : ${prompt}`
    }
    
    // Ajout de contraintes
    if (request.maxTokens && request.maxTokens < 2000) {
      prompt += `\n\nRéponse en maximum ${Math.floor(request.maxTokens * 0.75)} mots.`
    }
    
    return prompt
  }
  
  private calculateCost(agentName: string, tokens: number): number {
    const costPerToken = this.agentCapabilities[agentName as keyof typeof this.agentCapabilities]?.costPerToken || 0
    return tokens * costPerToken
  }
  
  private generateCacheKey(request: ContentGenerationRequest): string {
    const key = {
      type: request.type,
      prompt: request.prompt,
      parameters: request.parameters
    }
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(key))
      .digest('hex')
  }
  
  private async collectMetrics(
    request: ContentGenerationRequest,
    response: AIResponse,
    agent: string,
    executionTime: number
  ): Promise<void> {
    await this.metricsCollector.record('ai_request_completed', {
      agent,
      requestType: request.type,
      executionTime,
      tokensUsed: response.tokensUsed,
      cost: response.cost,
      quality: response.quality
    })
    
    // Mise à jour des budgets
    await this.costOptimizer.recordCost(response.cost)
  }
  
  async getMetrics(): Promise<any> {
    return {
      totalRequests: await this.metricsCollector.getCounter('ai_request_completed'),
      averageExecutionTime: await this.metricsCollector.getAverage('execution_time'),
      totalCost: await this.costOptimizer.getTotalCost(),
      circuitBreakerStates: Object.fromEntries(
        Array.from(this.circuitBreakers.entries()).map(([agent, cb]) => [agent, cb.getState()])
      )
    }
  }
}