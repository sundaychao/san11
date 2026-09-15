import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * vmThreads 池下 setupFiles 与测试文件分处不同模块上下文（实测同一个
 * '@testing-library/react' 会解析成两个实例）：setup.ts 注册的
 * afterEach(cleanup) 清的是空注册表，每轮空转。于是首个渲染弹窗的用例
 * 会把 DOM 泄漏给同文件后续所有用例（getByRole 报 "Found multiple
 * elements" 连环失败）。这里在转换期给每个 .test.tsx 注入文件内注册的
 * cleanup，保证与测试文件同一 RTL 实例。cleanup 幂等，与 setup.ts 的
 * afterEach 并存无害；日后换回 threads/forks 池也只是双保险。
 */
function rtlCleanupInjector(): Plugin {
  return {
    name: 'inject-rtl-cleanup-per-test-file',
    transform(code, id) {
      if (!/\.test\.tsx(?:\?.*)?$/.test(id) || id.includes('node_modules')) return null;
      if (code.includes('__rtlAfterEach')) return null;
      const inject =
        "import { afterEach as __rtlAfterEach } from 'vitest';\n" +
        "import { cleanup as __rtlCleanup } from '@testing-library/react';\n" +
        '__rtlAfterEach(() => __rtlCleanup());\n';
      return { code: inject + code, map: null };
    },
  };
}

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
    // 注意：Vitest 4 的 projects 不会继承顶层 test.pool / testTimeout，必须同时在每个 project 内声明。
    // 漏配 testTimeout 会让 project 回退到默认 5000ms，满载并发时重 UI 用例随机超时。
    pool: 'vmThreads',
    testTimeout: 30000,
    // 客户端与服务端测试需要不同的运行环境：
    // - src/** 依赖 DOM 与 React 测试库，跑 jsdom
    // - server/** 依赖 Node 内置模块（node:sqlite），必须跑 node，否则打包失败
    // Vitest 4 已移除 environmentMatchGlobs，改用 projects 划分。
    projects: [
      {
        plugins: [rtlCleanupInjector(), react()],
        test: {
          name: 'client',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: './src/test/setup.ts',
          css: true,
          pool: 'vmThreads',
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        test: {
          name: 'server',
          include: ['server/**/*.test.ts'],
          environment: 'node',
          pool: 'vmThreads',
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
