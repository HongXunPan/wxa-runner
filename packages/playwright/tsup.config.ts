import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  platform: 'node',
  target: 'node18',
  dts: true,
  sourcemap: true,
  external: ['@playwright/test', '@open-wxa/wxa-runner-core']
});
