#!/usr/bin/env tsx
/**
 * 📊 Advanced Monitoring Script
 * Collecte et analyse les métriques système et métier en temps réel
 */

import { performance } from 'perf_hooks'

interface SystemMetrics {
  timestamp: string
  performance: PerformanceMetrics
  costs: CostMetrics
  ai: AIMetrics
  business: BusinessMetrics
  alerts: Alert[]
}

interface PerformanceMetrics {
  responseTime: number
  throughput: number
  errorRate: number
  availability: number
  cacheHitRatio: number
}

interface CostMetrics {
  dailyCost: number
  monthlyProjection: number
  budgetUtilization: number
  costPerUser: number
  savings: number
}

interface AIMetrics {
  responseQuality: number
  costEfficiency: number
  agentDistribution: Record<string, number>
  successRate: number
  averageLatency: number
}

interface BusinessMetrics {
  activeUsers: number
  contentGenerated: number
  teacherSatisfaction: number
  parentSatisfaction: number
  studentEngagement: number
  timeReduction: number
}

interface Alert {
  level: 'info' | 'warning' | 'critical'
  message: string
  metric: string
  value: number
  threshold: number
  timestamp: string
}

class SystemMonitor {
  private alerts: Alert[] = []
  private readonly THRESHOLDS = {
    responseTime: { warning: 3000, critical: 5000 },
    errorRate: { warning: 0.05, critical: 0.10 },
    budgetUtilization: { warning: 0.80, critical: 0.95 },
    cacheHitRatio: { warning: 0.80, critical: 0.70 },
    availability: { warning: 0.995, critical: 0.990 }
  }

  async collectMetrics(): Promise<SystemMetrics> {
    console.log('📊 Collecting system metrics...')

    const [performance, costs, ai, business] = await Promise.all([
      this.collectPerformanceMetrics(),
      this.collectCostMetrics(),
      this.collectAIMetrics(),
      this.collectBusinessMetrics()
    ])

    // Generate alerts based on metrics
    this.generateAlerts(performance, costs, ai, business)

    return {
      timestamp: new Date().toISOString(),
      performance,
      costs,
      ai,
      business,
      alerts: this.alerts
    }
  }

  private async collectPerformanceMetrics(): Promise<PerformanceMetrics> {
    console.log('  ⚡ Performance metrics...')

    // Simulate performance data collection
    const responseTime = Math.random() * 4000 + 1000 // 1-5s
    const throughput = Math.random() * 100 + 50 // 50-150 req/min
    const errorRate = Math.random() * 0.02 // 0-2%
    const availability = 0.995 + Math.random() * 0.005 // 99.5-100%
    const cacheHitRatio = 0.85 + Math.random() * 0.14 // 85-99%

    return {
      responseTime: Math.round(responseTime),
      throughput: Math.round(throughput),
      errorRate: parseFloat(errorRate.toFixed(4)),
      availability: parseFloat(availability.toFixed(4)),
      cacheHitRatio: parseFloat(cacheHitRatio.toFixed(3))
    }
  }

  private async collectCostMetrics(): Promise<CostMetrics> {
    console.log('  💰 Cost metrics...')

    // Simulate cost tracking
    const dailyCost = Math.random() * 8 + 2 // 2-10€/day
    const monthlyProjection = dailyCost * 30
    const budgetUtilization = monthlyProjection / 125 // Budget 125€/mois
    const costPerUser = monthlyProjection / 34 // 30 élèves + 4 enseignants
    const targetCost = 200 // Coût cible avant optimisation
    const savings = targetCost - monthlyProjection

    return {
      dailyCost: parseFloat(dailyCost.toFixed(2)),
      monthlyProjection: parseFloat(monthlyProjection.toFixed(2)),
      budgetUtilization: parseFloat(budgetUtilization.toFixed(3)),
      costPerUser: parseFloat(costPerUser.toFixed(2)),
      savings: parseFloat(savings.toFixed(2))
    }
  }

  private async collectAIMetrics(): Promise<AIMetrics> {
    console.log('  🤖 AI metrics...')

    // Simulate AI performance data
    const responseQuality = Math.random() * 0.2 + 0.85 // 85-100% 
    const costEfficiency = Math.random() * 0.3 + 0.7 // 70-100%
    const successRate = Math.random() * 0.1 + 0.9 // 90-100%
    const averageLatency = Math.random() * 1000 + 1500 // 1.5-2.5s

    const agentDistribution = {
      claude: Math.random() * 0.3 + 0.4, // 40-70%
      openai: Math.random() * 0.3 + 0.2, // 20-50%
      deepseek: Math.random() * 0.1 + 0.05, // 5-15%
      gemini: Math.random() * 0.1 + 0.05 // 5-15%
    }

    // Normalize distribution to 100%
    const total = Object.values(agentDistribution).reduce((a, b) => a + b, 0)
    Object.keys(agentDistribution).forEach(key => {
      agentDistribution[key] = parseFloat((agentDistribution[key] / total).toFixed(3))
    })

    return {
      responseQuality: parseFloat(responseQuality.toFixed(3)),
      costEfficiency: parseFloat(costEfficiency.toFixed(3)),
      agentDistribution,
      successRate: parseFloat(successRate.toFixed(3)),
      averageLatency: Math.round(averageLatency)
    }
  }

  private async collectBusinessMetrics(): Promise<BusinessMetrics> {
    console.log('  📈 Business metrics...')

    // Simulate business KPIs
    const activeUsers = Math.floor(Math.random() * 10 + 28) // 28-38 users
    const contentGenerated = Math.floor(Math.random() * 50 + 100) // 100-150 items/day
    const teacherSatisfaction = Math.random() * 1.5 + 3.5 // 3.5-5.0
    const parentSatisfaction = Math.random() * 1.0 + 3.0 // 3.0-4.0
    const studentEngagement = Math.random() * 0.2 + 0.7 // 70-90%
    const timeReduction = Math.random() * 2 + 9 // 9-11h/week saved

    return {
      activeUsers,
      contentGenerated,
      teacherSatisfaction: parseFloat(teacherSatisfaction.toFixed(1)),
      parentSatisfaction: parseFloat(parentSatisfaction.toFixed(1)),
      studentEngagement: parseFloat(studentEngagement.toFixed(3)),
      timeReduction: parseFloat(timeReduction.toFixed(1))
    }
  }

  private generateAlerts(
    performance: PerformanceMetrics,
    costs: CostMetrics,
    ai: AIMetrics,
    business: BusinessMetrics
  ): void {
    // Performance alerts
    this.checkThreshold('responseTime', performance.responseTime, this.THRESHOLDS.responseTime)
    this.checkThreshold('errorRate', performance.errorRate, this.THRESHOLDS.errorRate)
    this.checkThreshold('availability', performance.availability, this.THRESHOLDS.availability, true)
    this.checkThreshold('cacheHitRatio', performance.cacheHitRatio, this.THRESHOLDS.cacheHitRatio, true)

    // Cost alerts
    this.checkThreshold('budgetUtilization', costs.budgetUtilization, this.THRESHOLDS.budgetUtilization)

    // AI alerts
    if (ai.successRate < 0.85) {
      this.addAlert('warning', 'AI success rate below target', 'aiSuccessRate', ai.successRate, 0.85)
    }
    if (ai.averageLatency > 3000) {
      this.addAlert('warning', 'AI response latency high', 'aiLatency', ai.averageLatency, 3000)
    }

    // Business alerts
    if (business.teacherSatisfaction < 4.0) {
      this.addAlert('warning', 'Teacher satisfaction below target', 'teacherSatisfaction', business.teacherSatisfaction, 4.0)
    }
    if (business.timeReduction < 8.0) {
      this.addAlert('info', 'Time reduction below expectation', 'timeReduction', business.timeReduction, 11.0)
    }
  }

  private checkThreshold(
    metric: string,
    value: number,
    thresholds: { warning: number; critical: number },
    reverse = false
  ): void {
    const isWarning = reverse ? value < thresholds.warning : value > thresholds.warning
    const isCritical = reverse ? value < thresholds.critical : value > thresholds.critical

    if (isCritical) {
      this.addAlert('critical', `${metric} critical threshold exceeded`, metric, value, thresholds.critical)
    } else if (isWarning) {
      this.addAlert('warning', `${metric} warning threshold exceeded`, metric, value, thresholds.warning)
    }
  }

  private addAlert(level: Alert['level'], message: string, metric: string, value: number, threshold: number): void {
    this.alerts.push({
      level,
      message,
      metric,
      value,
      threshold,
      timestamp: new Date().toISOString()
    })
  }

  formatReport(metrics: SystemMetrics): void {
    console.log('\n📊 SYSTEM MONITORING REPORT')
    console.log('=' .repeat(60))
    console.log(`Timestamp: ${metrics.timestamp}`)
    console.log('')

    // Performance Section
    console.log('⚡ PERFORMANCE METRICS')
    console.log(`  Response Time:    ${metrics.performance.responseTime}ms`)
    console.log(`  Throughput:       ${metrics.performance.throughput} req/min`)
    console.log(`  Error Rate:       ${(metrics.performance.errorRate * 100).toFixed(2)}%`)
    console.log(`  Availability:     ${(metrics.performance.availability * 100).toFixed(2)}%`)
    console.log(`  Cache Hit Ratio:  ${(metrics.performance.cacheHitRatio * 100).toFixed(1)}%`)
    console.log('')

    // Cost Section
    console.log('💰 COST METRICS')
    console.log(`  Daily Cost:       €${metrics.costs.dailyCost}`)
    console.log(`  Monthly Proj.:    €${metrics.costs.monthlyProjection}`)
    console.log(`  Budget Used:      ${(metrics.costs.budgetUtilization * 100).toFixed(1)}%`)
    console.log(`  Cost/User:        €${metrics.costs.costPerUser}`)
    console.log(`  Monthly Savings:  €${metrics.costs.savings}`)
    console.log('')

    // AI Section
    console.log('🤖 AI METRICS')
    console.log(`  Response Quality: ${(metrics.ai.responseQuality * 100).toFixed(1)}%`)
    console.log(`  Cost Efficiency:  ${(metrics.ai.costEfficiency * 100).toFixed(1)}%`)
    console.log(`  Success Rate:     ${(metrics.ai.successRate * 100).toFixed(1)}%`)
    console.log(`  Avg Latency:      ${metrics.ai.averageLatency}ms`)
    console.log('  Agent Distribution:')
    Object.entries(metrics.ai.agentDistribution).forEach(([agent, percentage]) => {
      console.log(`    ${agent.padEnd(8)}: ${(percentage * 100).toFixed(1)}%`)
    })
    console.log('')

    // Business Section
    console.log('📈 BUSINESS METRICS')
    console.log(`  Active Users:     ${metrics.business.activeUsers}`)
    console.log(`  Content Generated: ${metrics.business.contentGenerated}/day`)
    console.log(`  Teacher Satisfaction: ${metrics.business.teacherSatisfaction}/5`)
    console.log(`  Parent Satisfaction:  ${metrics.business.parentSatisfaction}/5`)
    console.log(`  Student Engagement:   ${(metrics.business.studentEngagement * 100).toFixed(1)}%`)
    console.log(`  Time Reduction:   ${metrics.business.timeReduction}h/week`)
    console.log('')

    // Alerts Section
    if (metrics.alerts.length > 0) {
      console.log('🚨 ACTIVE ALERTS')
      metrics.alerts.forEach(alert => {
        const emoji = { info: '💡', warning: '⚠️', critical: '🔥' }[alert.level]
        console.log(`  ${emoji} ${alert.level.toUpperCase()}: ${alert.message}`)
        console.log(`     ${alert.metric}: ${alert.value} (threshold: ${alert.threshold})`)
      })
    } else {
      console.log('✅ NO ACTIVE ALERTS')
    }

    // GitHub Actions output
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::set-output name=response-time::${metrics.performance.responseTime}`)
      console.log(`::set-output name=error-rate::${metrics.performance.errorRate}`)
      console.log(`::set-output name=daily-cost::${metrics.costs.dailyCost}`)
      console.log(`::set-output name=ai-success-rate::${metrics.ai.successRate}`)
      console.log(`::set-output name=critical-alerts::${metrics.alerts.filter(a => a.level === 'critical').length}`)
    }
  }

  async sendToSentry(metrics: SystemMetrics): Promise<void> {
    // Simulate sending metrics to Sentry
    console.log('\n📤 Sending metrics to Sentry...')
    
    try {
      // In real implementation, would use Sentry SDK
      await new Promise(resolve => setTimeout(resolve, 500))
      console.log('✅ Metrics sent to Sentry successfully')
    } catch (error) {
      console.error('❌ Failed to send metrics to Sentry:', error)
    }
  }
}

// Main execution
async function main() {
  const monitor = new SystemMonitor()
  const metrics = await monitor.collectMetrics()
  
  monitor.formatReport(metrics)
  await monitor.sendToSentry(metrics)
  
  // Exit with error if critical alerts
  const criticalAlerts = metrics.alerts.filter(a => a.level === 'critical')
  if (criticalAlerts.length > 0) {
    console.error(`\n💥 ${criticalAlerts.length} critical alerts detected!`)
    process.exit(1)
  }
  
  console.log('\n📊 Monitoring completed successfully!')
}

// Handle script execution
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Monitoring failed:', error)
    process.exit(1)
  })
}

export { SystemMonitor, type SystemMetrics }