import pino from 'pino'

/**
 * Configuration du logger Pino pour l'application
 * Support des environnements développement et production
 */
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:dd/mm/yyyy HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined,
  base: {
    env: process.env.NODE_ENV,
    service: 'mfr-education-automation'
  }
})

export default logger