/**
 * @open-wxa/wxa-runner-playwright：在 Playwright 里测试小程序
 *
 *   import { test, expect } from '@open-wxa/wxa-runner-playwright';
 *
 *   test('下单', async ({ miniProgram }) => {
 *     await miniProgram.open('pages/index/index');
 *     ...
 *   });
 */

import path from 'path';
import { expect as baseExpect, test as base } from '@playwright/test';
import { DevServer, DevServerOptions } from '@open-wxa/wxa-runner-core';
import { miniProgramMatchers } from './matchers';
import { createMiniProgram, MiniProgram } from './miniProgram';

export type { MiniProgram, MockHandler, RouteHandler } from './miniProgram';
export type { MiniProgramRequest } from './request';

/** 开发服务器的其余参数，如 baseLibVersion、device、setup */
export type WxaServerOptions = Omit<DevServerOptions, 'projectPath' | 'port' | 'host' | 'watch' | 'runtimeDir' | 'logger'>;

/** 在 playwright.config.ts 的 use 里配置，或在用例文件里用 test.use 修改 */
export interface WxaOptions {
  /**
   * 小程序项目目录（project.config.json 所在目录）。相对路径基于 Playwright 配置文件所在目录，默认就是这个目录。
   * 每个 worker 启动一个开发服务器：用 test.use 修改时，Playwright 会换一个 worker
   */
  wxaProject: string;
  /** 开发服务器的其余参数。同 wxaProject，每个 worker 一份 */
  wxaServerOptions: WxaServerOptions;
  /** 用例结束时检查 errors() 为空，默认 true。有意触发运行时错误的用例用 test.use({ wxaCheckErrors: false }) 关掉 */
  wxaCheckErrors: boolean;
}

export interface WxaFixtures {
  /** 当前用例的小程序：每个用例一个新的浏览器上下文，Storage、页面栈互不影响 */
  miniProgram: MiniProgram;
}

export interface WxaWorkerFixtures {
  /** 本 worker 的开发服务器，所有用例共用：编译只做一次 */
  wxaServer: DevServer;
}

const ERRORS_HINT = '小程序有运行时错误，或调用了未实现的 wx API（用到的请 mock）。有意触发错误的用例可以 test.use({ wxaCheckErrors: false })';

export const test = base.extend<
  WxaFixtures & Pick<WxaOptions, 'wxaCheckErrors'>,
  WxaWorkerFixtures & Pick<WxaOptions, 'wxaProject' | 'wxaServerOptions'>
>({
  wxaProject: ['.', { scope: 'worker', option: true }],
  wxaServerOptions: [{}, { scope: 'worker', option: true }],
  wxaCheckErrors: [true, { option: true }],

  wxaServer: [async ({ wxaProject, wxaServerOptions }, use, workerInfo) => {
    const configDir = workerInfo.config.configFile ? path.dirname(workerInfo.config.configFile) : process.cwd();
    const server = new DevServer({
      ...wxaServerOptions,
      projectPath: path.resolve(configDir, wxaProject),
      port: 0,
      watch: false,
      // 编译完成之类的日志每个 worker 都打一遍，只留警告和错误
      logger: { log: () => undefined, warn: console.warn, error: console.error }
    });
    await server.start();
    await use(server);
    await server.close();
  }, { scope: 'worker', timeout: 60000 }],

  miniProgram: async ({ page, wxaServer, wxaCheckErrors }, use) => {
    const session = await createMiniProgram(page, wxaServer.url);
    await use(session.miniProgram);

    session.throwHandlerError();
    if (wxaCheckErrors) {
      const errors = await page.evaluate(() => window.__wxa_test_api__?.errors() ?? []).catch(() => []);
      baseExpect(errors, ERRORS_HINT).toEqual([]);
    }
  }
});

export const expect = baseExpect.extend(miniProgramMatchers);
