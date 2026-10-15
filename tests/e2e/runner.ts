/**
 * e2e 公共部分：用临时小程序启动 DevServer，在 Chrome 里打开
 *
 * 需要本机安装微信开发者工具，以及 Chrome（或通过 WXA_CHROME 指定浏览器路径）。
 */

import fs from 'fs';
import path from 'path';
import { chromium, Frame, Page } from 'playwright';
import { expect } from 'vitest';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { createProject, hasToolchain, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const CHROME = process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const e2eReady = hasToolchain() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js')) && fs.existsSync(CHROME);

export interface RunnerOptions {
  chromeArgs?: string[];
  /** 授予页面的浏览器权限，如 camera */
  permissions?: string[];
  /** 不指定时用最新的兼容版本 */
  baseLibVersion?: string;
}

export interface Runner {
  base: string;
  page: Page;
  /** 打开宿主地址（如 /?path=pages/a/a），等小程序启动后返回当前页的渲染层 */
  open(url: string): Promise<Frame>;
  close(): Promise<void>;
}

export async function startRunner(files: Record<string, string | object>, options: RunnerOptions = {}): Promise<Runner> {
  const server = new DevServer({
    projectPath: createProject({
      'project.config.json': { appid: 'wxtest0000000000', compileType: 'miniprogram' },
      'app.js': 'App({});',
      ...files
    }),
    port: 0,
    watch: false,
    baseLibVersion: options.baseLibVersion,
    runtimeDir: RUNTIME_DIR,
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
  });
  const base = await server.start();
  const browser = await chromium.launch({ executablePath: CHROME, args: options.chromeArgs });
  const context = await browser.newContext({ permissions: options.permissions });
  const page = await context.newPage();

  return {
    base,
    page,
    async open(url) {
      await page.goto(base + url);
      await page.waitForFunction(() => window.__wxa_test_api__);
      await page.evaluate(() => window.__wxa_test_api__.ready);
      const { frameName } = (await page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
      return page.frame({ name: frameName })!;
    },
    async close() {
      await browser.close();
      await server.close();
    }
  };
}

/** 等元素文本变成期望值；超时后用实际文本断言，失败信息里能看到页面停在了哪一步 */
export async function expectText(frame: Frame, selector: string, expected: string | RegExp, timeout = 5000) {
  const pattern = typeof expected === 'string' ? { source: expected, exact: true } : { source: expected.source, exact: false };
  await frame.waitForFunction(
    ([s, p]) => {
      const text = document.querySelector(s)?.textContent ?? '';
      return p.exact ? text === p.source : new RegExp(p.source).test(text);
    },
    [selector, pattern] as const,
    { timeout }
  ).catch(() => undefined);
  const actual = await frame.textContent(selector);
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else expect(actual).toMatch(expected);
}
