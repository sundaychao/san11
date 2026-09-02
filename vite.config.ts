import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // 按变动频率拆 chunk：react/第三方几乎不变，游戏引擎(src/game)稳定增长，
        // UI(src/components 等)迭代最频繁——各自独立缓存，改 UI 不让玩家重新下载引擎。
        advancedChunks: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
            { name: 'scenario-data', test: /[\\/]scenario[\\/]china42\.json/ },
            { name: 'game-engine', test: /src[\\/]game[\\/]/ },
          ],
        },
      },
    },
  },
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
