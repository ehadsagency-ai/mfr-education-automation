import { defineConfig, devices } from '@playwright/test'

/**
 * Configuration Playwright pour tests E2E
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000, // 30 seconds
  expect: {
    timeout: 5000
  },
  
  // Fail fast - stop after first failure in CI
  fullyParallel: !process.env.CI,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter configuration
  reporter: [
    ['html'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    process.env.CI ? ['github'] : ['list']
  ],
  
  // Global test configuration
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Locale and timezone
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    
    // Ignore HTTPS errors for development
    ignoreHTTPSErrors: true,
    
    // Auth state file for authenticated tests
    storageState: 'tests/e2e/auth/user.json'
  },

  // Test projects for different browsers and scenarios
  projects: [
    // Setup project for authentication
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      teardown: 'cleanup'
    },
    {
      name: 'cleanup', 
      testMatch: /.*\.teardown\.ts/
    },

    // Desktop browsers
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 }
      },
      dependencies: ['setup']
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 }
      },
      dependencies: ['setup']
    },
    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 }
      },
      dependencies: ['setup']
    },

    // Mobile devices
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 5']
      },
      dependencies: ['setup']
    },
    {
      name: 'Mobile Safari',
      use: { 
        ...devices['iPhone 12']
      },
      dependencies: ['setup']
    },

    // Tablet
    {
      name: 'iPad',
      use: { 
        ...devices['iPad Pro']
      },
      dependencies: ['setup']
    },

    // Accessibility testing
    {
      name: 'accessibility',
      use: { 
        ...devices['Desktop Chrome'],
        contextOptions: {
          // High contrast
          colorScheme: 'dark',
          // Reduce motion
          reducedMotion: 'reduce'
        }
      },
      testMatch: /.*\.a11y\.spec\.ts/,
      dependencies: ['setup']
    },

    // Performance testing
    {
      name: 'performance',
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--enable-precise-memory-info']
        }
      },
      testMatch: /.*\.perf\.spec\.ts/,
      dependencies: ['setup']
    }
  ],

  // Web server configuration
  webServer: {
    command: 'npm run preview',
    port: 3000,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test'
    }
  }
})