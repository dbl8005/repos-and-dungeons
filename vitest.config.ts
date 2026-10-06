import { defineConfig } from 'vitest/config';

// Browser e2e tests run separately (`npm run test:e2e`): they compete for CPU with the timing budgets.
export default defineConfig({
  test: {
    include: process.env.RD_E2E ? ['test/e2e/**/*.test.ts'] : ['test/**/*.test.ts'],
    exclude: process.env.RD_E2E ? [] : ['test/e2e/**', 'node_modules/**'],
    fileParallelism: !process.env.RD_E2E,
    testTimeout: 15000,
  },
});
