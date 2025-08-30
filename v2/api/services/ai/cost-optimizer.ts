import type { CostOptimization, AIRequest } from '@/types/ai'
import { Logger } from '@/services/logging'
import { MetricsCollector } from '@/services/monitoring'

export class CostOptimizer {
  private logger = new Logger('CostOptimizer')
  private metricsCollector = new MetricsCollector()
  
  // Budget configuration
  private readonly MONTHLY_BUDGET = parseFloat(process.env.MONTHLY_BUDGET || '125') // euros
  private readonly DAILY_BUDGET = this.MONTHLY_BUDGET / 30
  private readonly HOURLY_BUDGET = this.DAILY_BUDGET / 24
  
  // Coûts actuels (stockés en Redis/cache)
  private dailyCost = 0
  private hourlyCost = 0
  private monthlyCost = 0
  
  constructor() {
    this.initializeCostTracking()
  }
  
  private async initializeCostTracking(): Promise<void> {
    // Récupération des coûts depuis le cache/DB
    try {
      const today = new Date().toISOString().split('T')[0]
      const thisMonth = new Date().toISOString().substring(0, 7)
      const thisHour = new Date().toISOString().substring(0, 13)
      
      // TODO: Récupération depuis Redis ou MongoDB
      this.dailyCost = await this.getCostFromCache(`daily_cost_${today}`) || 0
      this.monthlyCost = await this.getCostFromCache(`monthly_cost_${thisMonth}`) || 0
      this.hourlyCost = await this.getCostFromCache(`hourly_cost_${thisHour}`) || 0
      
    } catch (error) {
      this.logger.error('Erreur initialisation cost tracking', { error })
    }
  }
  
  async optimize(request: any): Promise<CostOptimization> {
    const currentBudgetStatus = await this.getBudgetStatus()
    
    // Stratégie d'optimisation basée sur le budget restant
    if (currentBudgetStatus.dailyRemaining < 0.5) {
      return this.getCriticalBudgetStrategy(request)
    } else if (currentBudgetStatus.dailyRemaining < 2) {
      return this.getConservativeBudgetStrategy(request)
    } else {
      return this.getNormalBudgetStrategy(request)
    }
  }
  
  private getCriticalBudgetStrategy(request: any): CostOptimization {
    return {
      selectedAgent: 'gemini', // Le moins cher
      maxTokens: 1000,
      temperature: 0.3,
      useCache: true,
      qualityLevel: 'basic',
      priority: 'cost',
      estimatedCost: 0.005,
      reasoning: 'Budget critique - mode économique activé'
    }
  }
  
  private getConservativeBudgetStrategy(request: any): CostOptimization {
    // Analyse du type de requête pour optimiser
    if (this.isHighPriorityRequest(request)) {
      return {
        selectedAgent: 'openai',
        maxTokens: 2000,
        temperature: 0.5,
        useCache: true,
        qualityLevel: 'standard',
        priority: 'balanced',
        estimatedCost: 0.020,
        reasoning: 'Budget serré - qualité standard pour requête prioritaire'
      }
    } else {
      return {
        selectedAgent: 'deepseek',
        maxTokens: 1500,
        temperature: 0.4,
        useCache: true,
        qualityLevel: 'basic',
        priority: 'cost',
        estimatedCost: 0.003,
        reasoning: 'Budget serré - mode économique'
      }
    }
  }
  
  private getNormalBudgetStrategy(request: any): CostOptimization {
    // Sélection optimale basée sur la spécialisation
    const optimalAgent = this.selectOptimalAgentForRequest(request)
    
    return {
      selectedAgent: optimalAgent,
      maxTokens: 4000,
      temperature: 0.7,
      useCache: false, // Pas de cache forcé en mode normal
      qualityLevel: 'high',
      priority: 'quality',
      estimatedCost: this.estimateCost(optimalAgent, 4000),
      reasoning: 'Budget normal - optimisation qualité/spécialisation'
    }
  }
  
  private selectOptimalAgentForRequest(request: any): string {
    // Matrice de sélection basée sur le type de contenu
    const agentSpecialization = {
      pedagogical_analysis: 'claude',
      creative_content: 'openai',
      technical_optimization: 'deepseek',
      fact_checking: 'gemini',
      student_feedback: 'claude',
      gamified_exercise: 'openai',
      research: 'gemini',
      code_analysis: 'deepseek'
    }
    
    return agentSpecialization[request.type as keyof typeof agentSpecialization] || 'claude'
  }
  
  private isHighPriorityRequest(request: any): boolean {
    const highPriorityTypes = [
      'student_feedback',
      'urgent_analysis',
      'critical_content'
    ]
    
    return highPriorityTypes.includes(request.type) || request.priority === 'high'
  }
  
  private estimateCost(agent: string, tokens: number): number {
    const costPerToken = {
      claude: 0.000015,
      openai: 0.000010,
      deepseek: 0.000002,
      gemini: 0.000005
    }
    
    return tokens * (costPerToken[agent as keyof typeof costPerToken] || 0.000010)
  }
  
  async recordCost(cost: number): Promise<void> {
    try {
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const thisMonth = now.toISOString().substring(0, 7)
      const thisHour = now.toISOString().substring(0, 13)
      
      // Mise à jour des compteurs
      this.dailyCost += cost
      this.monthlyCost += cost
      this.hourlyCost += cost
      
      // Sauvegarde en cache
      await Promise.all([
        this.setCostInCache(`daily_cost_${today}`, this.dailyCost),
        this.setCostInCache(`monthly_cost_${thisMonth}`, this.monthlyCost),
        this.setCostInCache(`hourly_cost_${thisHour}`, this.hourlyCost)
      ])
      
      // Métriques
      await this.metricsCollector.record('ai_cost_recorded', {
        cost,
        dailyTotal: this.dailyCost,
        monthlyTotal: this.monthlyCost,
        dailyBudgetUsed: (this.dailyCost / this.DAILY_BUDGET) * 100
      })
      
      // Alertes budget si nécessaire
      await this.checkBudgetAlerts()
      
    } catch (error) {
      this.logger.error('Erreur enregistrement coût', { error, cost })
    }
  }
  
  private async checkBudgetAlerts(): Promise<void> {
    const budgetStatus = await this.getBudgetStatus()
    
    // Alerte 80% du budget journalier
    if (budgetStatus.dailyUsedPercent >= 80 && budgetStatus.dailyUsedPercent < 95) {
      await this.sendBudgetAlert('warning', {
        type: 'daily_budget_80',
        current: this.dailyCost,
        limit: this.DAILY_BUDGET,
        percentage: budgetStatus.dailyUsedPercent
      })
    }
    
    // Alerte 95% du budget journalier
    if (budgetStatus.dailyUsedPercent >= 95) {
      await this.sendBudgetAlert('critical', {
        type: 'daily_budget_95',
        current: this.dailyCost,
        limit: this.DAILY_BUDGET,
        percentage: budgetStatus.dailyUsedPercent
      })
    }
    
    // Alerte 90% du budget mensuel
    if (budgetStatus.monthlyUsedPercent >= 90) {
      await this.sendBudgetAlert('critical', {
        type: 'monthly_budget_90',
        current: this.monthlyCost,
        limit: this.MONTHLY_BUDGET,
        percentage: budgetStatus.monthlyUsedPercent
      })
    }
  }
  
  private async sendBudgetAlert(level: 'warning' | 'critical', data: any): Promise<void> {
    this.logger.warn('Budget alert triggered', { level, data })
    
    // TODO: Envoyer notifications via Slack, email, etc.
    await this.metricsCollector.record('budget_alert_sent', { level, ...data })
  }
  
  async getBudgetStatus(): Promise<{
    dailyUsed: number
    dailyRemaining: number
    dailyUsedPercent: number
    monthlyUsed: number
    monthlyRemaining: number
    monthlyUsedPercent: number
    recommendations: string[]
  }> {
    const dailyUsedPercent = (this.dailyCost / this.DAILY_BUDGET) * 100
    const monthlyUsedPercent = (this.monthlyCost / this.MONTHLY_BUDGET) * 100
    
    const recommendations = []
    
    if (dailyUsedPercent > 80) {
      recommendations.push('Activer le mode économique pour le reste de la journée')
    }
    if (monthlyUsedPercent > 75) {
      recommendations.push('Réduire la fréquence des requêtes IA non critiques')
    }
    if (this.hourlyCost > this.HOURLY_BUDGET * 2) {
      recommendations.push('Pic de consommation détecté - vérifier les requêtes en cours')
    }
    
    return {
      dailyUsed: this.dailyCost,
      dailyRemaining: Math.max(0, this.DAILY_BUDGET - this.dailyCost),
      dailyUsedPercent,
      monthlyUsed: this.monthlyCost,
      monthlyRemaining: Math.max(0, this.MONTHLY_BUDGET - this.monthlyCost),
      monthlyUsedPercent,
      recommendations
    }
  }
  
  async getTotalCost(): Promise<number> {
    return this.monthlyCost
  }
  
  async resetDailyCost(): Promise<void> {
    this.dailyCost = 0
    this.hourlyCost = 0
    
    const today = new Date().toISOString().split('T')[0]
    const thisHour = new Date().toISOString().substring(0, 13)
    
    await Promise.all([
      this.setCostInCache(`daily_cost_${today}`, 0),
      this.setCostInCache(`hourly_cost_${thisHour}`, 0)
    ])
  }
  
  async resetMonthlyCost(): Promise<void> {
    this.monthlyCost = 0
    this.dailyCost = 0
    this.hourlyCost = 0
    
    const thisMonth = new Date().toISOString().substring(0, 7)
    await this.setCostInCache(`monthly_cost_${thisMonth}`, 0)
  }
  
  // Méthodes de cache (à implémenter avec Redis ou DB)
  private async getCostFromCache(key: string): Promise<number> {
    // TODO: Implémenter avec Redis/MongoDB
    return 0
  }
  
  private async setCostInCache(key: string, value: number): Promise<void> {
    // TODO: Implémenter avec Redis/MongoDB
    this.logger.debug('Setting cost in cache', { key, value })
  }
  
  // Méthodes d'analyse prédictive
  async predictMonthlyCost(): Promise<{
    predicted: number
    confidence: number
    recommendation: string
  }> {
    const daysInMonth = new Date().getDate()
    const totalDaysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    
    // Prédiction linéaire simple
    const averageDailyCost = this.monthlyCost / daysInMonth
    const predictedMonthlyCost = averageDailyCost * totalDaysInMonth
    
    // Confidence basée sur la stabilité des coûts journaliers
    const confidence = Math.min(0.95, daysInMonth / totalDaysInMonth)
    
    let recommendation = 'Budget sur la bonne voie'
    if (predictedMonthlyCost > this.MONTHLY_BUDGET * 1.1) {
      recommendation = 'Risque de dépassement - réduire la consommation'
    } else if (predictedMonthlyCost < this.MONTHLY_BUDGET * 0.7) {
      recommendation = 'Sous-consommation - possibilité d\'améliorer la qualité'
    }
    
    return {
      predicted: predictedMonthlyCost,
      confidence,
      recommendation
    }
  }
}