import { defineConfig } from 'tsup';

export default defineConfig([
  // Node 端：开发服务器与构建器
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    platform: 'node',
    target: 'node18',
    dts: true,
    sourcemap: true,
    shims: true,
    external: ['express', 'chokidar', 'ws', 'esbuild', '@open-wxa/wxa-runner-compiler', '@open-wxa/wxa-runner-extractor']
  },
  // 浏览器端：宿主页面与注入 iframe 的桥
  {
    entry: { 'runtime/host': 'src/runtime/host/index.ts', 'runtime/frame': 'src/runtime/frame.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    outExtension: () => ({ js: '.js' })
  }
]);
