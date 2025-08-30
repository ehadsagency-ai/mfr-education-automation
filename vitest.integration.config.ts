/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * Configuration Vitest pour tests d'intégration
 * Tests avec vraies APIs et base de données de test
 */
export default defineConfig({
  plugins: [vue()],
  
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/api': resolve(__dirname, './api'),
      '@/types': resolve(__dirname, './src/types')
    }
  },

  test: {
    name: 'integration',
    root: '.',
    
    // Test files pattern
    include: ['tests/integration/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.git'],
    
    // Environment setup
    environment: 'node',
    
    // Globals and setup
    globals: true,
    setupFiles: ['tests/integration/setup.ts'],
    
    // Timeout configuration
    testTimeout: 30000,
    hookTimeout: 10000,
    
    // Reporter configuration
    reporter: [
      'verbose',
      'junit',
      'json'
    ],
    
    outputFile: {
      junit: './test-results/integration-junit.xml',
      json: './test-results/integration-results.json'
    },
    
    // Coverage configuration for integration tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/integration',
      
      include: [
        'api/**/*.ts',
        'src/services/**/*.ts',
        'src/stores/**/*.ts'
      ],
      
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.config.ts',
        '**/types/**',
        'tests/**'
      ],
      
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    },
    
    // Retry configuration
    retry: process.env.CI ? 2 : 0,
    
    // Parallel execution
    pool: 'threads',
    maxConcurrency: process.env.CI ? 1 : 4,
    
    // Test isolation
    isolate: true,
    
    // Environment variables
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/mfr_test',
      CLAUDE_API_KEY: 'test-key',
      OPENAI_API_KEY: 'test-key'
    }
  }
})