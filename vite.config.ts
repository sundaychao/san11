import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // vmThreads: threads/forks 池在 Node 24 + Vitest 4.1 下 worker 全局状态
    // （__vitest_worker__）注入失败，导致所有 vi API 报 "failed to find the runner"。
    pool: 'vmThreads',
    testTimeout: 30000,
    // 客户端与服务端测试需要不同的运行环境：
    // - src/** 依赖 DOM 与 React 测试库，跑 jsdom
    // - server/** 依赖 Node 内置模块（node:sqlite），必须跑 node，否则打包失败
    // Vitest 4 已移除 environmentMatchGlobs，改用 projects 划分。
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'client',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: './src/test/setup.ts',
          css: true,
        },
      },
      {
        test: {
          name: 'server',
          include: ['server/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
