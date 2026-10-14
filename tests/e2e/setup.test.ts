/**
 * 端到端：setup 在 App.onLaunch 之前生效，用来跳过登录等真机才有的环节
 *
 * 需要本机安装微信开发者工具，以及 Chrome（或通过 WXA_CHROME 指定浏览器路径）。
 */

import fs from 'fs';
import path from 'path';
import { Browser, chromium, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { createProject, hasDevtools, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const CHROME = process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ready = hasDevtools() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js')) && fs.existsSync(CHROME);

// 常见的登录态判断：启动时读本地 token，没有就走登录
const APP_JS = `
App({
  globalData: {},
  onLaunch() {
    this.globalData.token = wx.getStorageSync('token');
    this.globalData.userInfo = wx.getStorageSync('userInfo');
  }
});
`;

const PAGE_JS = `
Page({
  data: { token: '', nickName: '', code: '' },
  onLoad() {
    const { token, userInfo } = getApp().globalData;
    this.setData({ token: token || '未登录', nickName: (userInfo && userInfo.nickName) || '' });
    wx.login({ success: res => this.setData({ code: res.code }) });
  }
});
`;

function miniProgram(setup: string) {
  return createProject({
    'project.config.json': { appid: 'wxtest0000000000', compileType: 'miniprogram' },
    'app.json': { pages: ['pages/index/index'] },
    'app.js': APP_JS,
    'app.wxss': '',
    'pages/index/index.json': {},
    'pages/index/index.js': PAGE_JS,
    'pages/index/index.wxml': '<view id="token">{{token}}</view><view id="nick">{{nickName}}</view><view id="code">{{code}}</view>',
    'pages/index/index.wxss': '',
    'wxa.setup.js': setup
  });
}

describe.skipIf(!ready)('setup 跳过登录', () => {
  let server: DevServer | undefined;
  let browser: Browser;
  let page: Page;

  const open = async (setup: string) => {
    server = new DevServer({
      projectPath: miniProgram(setup),
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    await page.goto(await server.start());
    await page.waitForFunction(() => window.__wxa_test_api__);
  };

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME });
  });

  afterEach(async () => {
    await page?.close();
    await server?.close();
    server = undefined;
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  it('开发者预置 token 和登录 code 后，小程序启动即为已登录状态', async () => {
    process.env.WXA_TOKEN = 'token-from-env';
    try {
      await open(`
        export default ({ env }) => ({
          storage: { token: env.WXA_TOKEN, userInfo: { nickName: '测试用户' } },
          mock: { login: { code: 'dev_code' } }
        });
      `);
    } finally {
      delete process.env.WXA_TOKEN;
    }
    await page.evaluate(() => window.__wxa_test_api__.ready);

    const { frameName } = (await page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
    const frame = page.frame({ name: frameName })!;
    // App.onLaunch 里读到的就是预置值：setup 早于小程序启动完成
    await frame.waitForFunction(() => document.querySelector('#token')?.textContent === 'token-from-env');
    expect(await frame.textContent('#nick')).toBe('测试用户');
    await frame.waitForFunction(() => document.querySelector('#code')?.textContent === 'dev_code');
    expect(await page.evaluate(() => window.__wxa_test_api__.getStorage('userInfo'))).toEqual({ nickName: '测试用户' });
  });

  it('setup 执行出错时，开发者在模拟器里看到错误，小程序不带着半成品状态启动', async () => {
    await open(`
      export default {
        storage: { token: 'x' },
        run() { throw new Error('测试后端不可用'); }
      };
    `);

    await page.waitForSelector('.wxa-error');
    expect(await page.textContent('.wxa-error')).toMatch(/setup[\s\S]*测试后端不可用/);
    expect(await page.evaluate(() => window.__wxa_test_api__.currentPage())).toBeNull();
  });
});
