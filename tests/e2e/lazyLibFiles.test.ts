/**
 * e2e：渲染层按需加载基础库文件
 *
 * 3.3.x、3.5.x 的 video 等组件不在 WAWebview.js 里，渲染层用到时才经 loadLibFilesSync 加载。
 * 用模拟基础库（tests/fakeBaseLib.ts）固定这个约定；真实基础库上的表现用 WXA_BASELIB=3.5.8 pnpm test 覆盖。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeVendorDir, FAKE_BASELIBS } from '../fakeBaseLib';
import { e2eReady, Runner, startRunner } from './runner';

describe.skipIf(!e2eReady)('渲染层按需加载基础库文件', () => {
  let runner: Runner;

  beforeAll(async () => {
    vi.stubEnv('WXA_VENDOR_DIR', createFakeVendorDir());
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view>页面</view>',
      'pages/index/index.js': 'Page({});'
    }, {
      baseLibVersion: FAKE_BASELIBS.lazyLibFiles.version,
      baseLibCacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-fake-cache-'))
    });
  });

  afterAll(async () => {
    await runner?.close();
    vi.unstubAllEnvs();
  });

  it('基础库在渲染层同步加载自己的文件：脚本在调用返回前已在渲染层执行，各文件的内容按顺序交回，CSS 不当脚本执行', async () => {
    const frame = await runner.open('/');
    const loaded = await frame.evaluate(() => {
      const g = window as any;
      return { runs: g.__lazyRuns, runsWhenReturned: g.__lazyRunsWhenReturned, codes: g.__lazyCodes };
    });

    expect(loaded).toEqual({
      runs: 1,
      runsWhenReturned: 1,
      codes: [FAKE_BASELIBS.lazyLibFiles.files['/WALazyComponent.js'], FAKE_BASELIBS.lazyLibFiles.files['/WALazyComponent.css']]
    });
    expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
  });
});
