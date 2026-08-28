import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    environment: 'jsdom',
    // vmThreads: threads/forks 池在 Node 24 + Vitest 4.1 下 worker 全局状态
    // （__vitest_worker__）注入失败，导致所有 vi API 报 "failed to find the runner"。
    pool: 'vmThreads',
    setupFiles: './src/test/setup.ts',
    css: true,
    testTimeout: 30000,
  },
});
