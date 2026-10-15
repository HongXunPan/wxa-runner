/**
 * 端到端：用到基础库伴生 SDK 子包的能力时不阻断页面
 *
 * 回归的是这个崩溃：wx.createRewardedVideoAd 在基础库里是 new ADSDK.RewardedVideoAd()，
 * 而 ADSDK 由 WAAppAd.js 提供、运行时不加载，于是抛 TypeError 打断整个 onLoad。
 */

import fs from 'fs';
import path from 'path';
import { Browser, chromium, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { createProject, hasToolchain, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const CHROME = process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ready = hasToolchain() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js')) && fs.existsSync(CHROME);

const PAGE_JS = `
Page({
  data: { step: 'start', adError: '' },
  onLoad() {
    this.setData({ step: 'onLoad 开始' });
    const ad = wx.createRewardedVideoAd({ adUnitId: 'adunit-test' });
    ad.onError(err => this.setData({ adError: String(err && err.errMsg) }));
    ad.load().catch(() => undefined);
    // 崩溃时这一行永远跑不到
    this.setData({ step: 'onLoad 结束' });
  }
});
`;

describe.skipIf(!ready)('伴生 SDK 子包占位', () => {
  let server: DevServer;
  let browser: Browser;
  let page: Page;
  let base = '';

  beforeAll(async () => {
    const projectPath = createProject({
      'project.config.json': { appid: 'wxtest0000000000', compileType: 'miniprogram' },
      'app.json': { pages: ['pages/ad/ad'] },
      'app.js': 'App({});',
      'app.wxss': '',
      'pages/ad/ad.json': {},
      'pages/ad/ad.js': PAGE_JS,
      'pages/ad/ad.wxml': '<view id="step">{{step}}</view><view id="ad-error">{{adError}}</view>',
      'pages/ad/ad.wxss': ''
    });

    server = new DevServer({
      projectPath,
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    base = await server.start();
    browser = await chromium.launch({ executablePath: CHROME });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('createRewardedVideoAd 不再打断 onLoad，失败走 onError', async () => {
    await page.goto(base);
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);

    const { frameName } = (await page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
    const frame = page.frame({ name: frameName })!;

    await frame.waitForFunction(() => document.querySelector('#step')?.textContent === 'onLoad 结束');
    await frame.waitForFunction(() => (document.querySelector('#ad-error')?.textContent || '').length > 0);

    const errors = await page.evaluate(() => window.__wxa_test_api__.errors());
    expect(errors.filter(e => e.message.includes('RewardedVideoAd'))).toEqual([]);
  });
});
