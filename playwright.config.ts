/**
 * tests/playwright：用 @open-wxa/wxa-runner-playwright 的 fixture 写的用例，接法与外部项目相同
 *
 * 先 pnpm build。Chrome 同 e2e：默认 /Applications/Google Chrome.app，其他位置用环境变量 WXA_CHROME 指定。
 */

import { defineConfig } from '@playwright/test';
import type { WxaOptions } from '@open-wxa/wxa-runner-playwright';

export default defineConfig<WxaOptions>({
  testDir: 'tests/playwright',
  fullyParallel: true,
  // 同 e2e：完整版 Chrome 多个实例同时运行时偶尔会卡死，限制并发
  workers: 2,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    wxaProject: 'tests/playwright/app',
    launchOptions: {
      executablePath: process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    }
  }
});
