import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        // 只做 re-export
        'packages/*/src/index.ts',
        // 依赖 DOM、只在浏览器里运行，由 tests/e2e 覆盖（Node 的覆盖率工具统计不到）
        'packages/core/src/runtime/frame.ts',
        'packages/core/src/runtime/host/index.ts',
        'packages/core/src/runtime/host/Host.ts',
        'packages/core/src/runtime/host/PageView.ts',
        'packages/core/src/runtime/host/pageStackRestore.ts',
        'packages/core/src/runtime/host/testApi.ts',
        'packages/core/src/runtime/host/api/webView.ts',
        'packages/core/src/runtime/host/ui/**'
      ],
      reporter: ['text-summary', 'text']
    }
  }
});
