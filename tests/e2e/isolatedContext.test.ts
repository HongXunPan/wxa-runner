/**
 * e2e：新版基础库（3.7.1 起）的隔离上下文，即 runtime/context.ts 模拟的原生 WeixinJSContext
 *
 * 用模拟基础库（tests/fakeBaseLib.ts）固定住原生接口的约定，不依赖本机有新版基础库；
 * 真实基础库上的表现用 WXA_BASELIB=<版本> pnpm test 覆盖。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeVendorDir, FAKE_BASELIBS } from '../fakeBaseLib';
import { e2eReady, startRunner } from './runner';

const files = {
  'app.json': { pages: ['pages/index/index'] },
  'pages/index/index.json': {},
  'pages/index/index.wxml': '<view>{{text}}</view>',
  'pages/index/index.js': 'Page({ data: { text: "来自子上下文" } });'
};

describe.skipIf(!e2eReady)('新版基础库的隔离上下文', () => {
  let baseLibCacheDir = '';

  beforeAll(() => {
    vi.stubEnv('WXA_VENDOR_DIR', createFakeVendorDir());
    baseLibCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-fake-cache-'));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const launch = async (version: string) => {
    const runner = await startRunner(files, { baseLibVersion: version, baseLibCacheDir });
    try {
      await runner.open('/');
      return await runner.page.evaluate(() => ({
        data: window.__wxa_test_api__.pageData(),
        errors: window.__wxa_test_api__.errors().map(error => error.message)
      }));
    } finally {
      await runner.close();
    }
  };

  it.each([
    ['带回调的 evaluateScriptFile', FAKE_BASELIBS.evaluateScriptFile.version],
    ['同步的 loadJsFiles', FAKE_BASELIBS.loadJsFiles.version]
  ])('基础库用%s执行业务入口时，小程序正常启动，测试 API 读到的是子上下文里的页面', async (_how, version) => {
    expect(await launch(version)).toEqual({ data: { text: '来自子上下文' }, errors: [] });
  });

  it('基础库没有创建业务子上下文时，启动不会一直挂起：报告停在哪一步，照常结束启动', async () => {
    const { errors } = await launch(FAKE_BASELIBS.noAppContext.version);
    expect(errors).toEqual([expect.stringMatching(/没有创建业务子上下文/)]);
  });
});
