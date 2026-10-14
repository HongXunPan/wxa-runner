/**
 * 开发服务器加载 setup 文件：发现、编译、注入环境变量
 */

import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { createProject, hasDevtools, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const ready = hasDevtools() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js'));

const MINI_PROGRAM = {
  'project.config.json': { appid: 'wxtest0000000000', compileType: 'miniprogram' },
  'app.json': { pages: ['pages/index/index'] },
  'app.js': 'App({});',
  'pages/index/index.json': {},
  'pages/index/index.js': 'Page({});',
  'pages/index/index.wxml': '<view>index</view>'
};

const SETUP_TS = `
import { defineSetup } from '@open-wxa/wxa-runner-core/setup';
import { USER } from './fixtures/user';

const code: string = 'dev_code';
export default defineSetup(({ env }) => ({
  storage: { token: env.WXA_TOKEN, userInfo: USER },
  mock: { login: { code } }
}));
`;

describe.skipIf(!ready)('开发服务器加载 setup', () => {
  let server: DevServer | undefined;
  const savedEnv = { ...process.env };

  const start = async (files: Record<string, string | object>, options: { setup?: string } = {}) => {
    const projectPath = createProject({ ...MINI_PROGRAM, ...files });
    server = new DevServer({
      projectPath,
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      setup: options.setup && path.join(projectPath, options.setup),
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    const base = await server.start();
    return {
      projectPath,
      get: (url: string) => fetch(base + url),
      appInfo: async () => (await fetch(base + '/__wxa__/app-info.json')).json()
    };
  };

  afterEach(async () => {
    await server?.close();
    server = undefined;
    process.env = { ...savedEnv };
  });

  it('项目根目录的 wxa.setup.ts 自动生效，连同它 import 的文件一起编译', async () => {
    const { get, appInfo } = await start({
      'wxa.setup.ts': SETUP_TS,
      'fixtures/user.ts': 'export const USER = { id: 1, nickName: "dev" };'
    });

    expect((await appInfo()).setup).toMatchObject({ env: {} });

    const res = await get('/__wxa__/setup.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const code = await res.text();
    expect(code).toContain('dev_code');
    expect(code).toContain('nickName');
    // TS 已编译、运行时自带的 defineSetup 已内联，浏览器里不需要再解析任何包
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/: string/);
  });

  it('只有 WXA_ 前缀的环境变量会暴露给 setup', async () => {
    process.env.WXA_TOKEN = 't-123';
    process.env.SECRET_KEY = 'must-not-leak';
    const { appInfo } = await start({ 'wxa.setup.ts': SETUP_TS, 'fixtures/user.ts': 'export const USER = {};' });

    const { env } = (await appInfo()).setup;
    expect(env.WXA_TOKEN).toBe('t-123');
    expect(env.SECRET_KEY).toBeUndefined();
  });

  it('开发者可以指定任意路径的 setup 文件', async () => {
    const { get, appInfo } = await start(
      { 'scripts/login.setup.js': 'export default { storage: { token: "custom" } };' },
      { setup: 'scripts/login.setup.js' }
    );
    expect((await appInfo()).setup).toBeDefined();
    expect(await (await get('/__wxa__/setup.js')).text()).toContain('custom');
  });

  it('setup 编译失败时，错误连同文件位置一起交给宿主', async () => {
    const { appInfo } = await start({ 'wxa.setup.js': 'export default { storage: { token: ' });
    const info = await appInfo();
    expect(info.setup.error).toMatch(/wxa\.setup\.js/);
  });

  it('没有 setup 文件的项目启动方式不变', async () => {
    const { get, appInfo } = await start({});
    expect((await appInfo()).setup).toBeUndefined();
    expect((await get('/__wxa__/setup.js')).status).toBe(404);
  });

  it('小程序根目录下的 wxa.setup.js 不会被当成小程序模块加载', async () => {
    const { get } = await start({ 'wxa.setup.js': 'export default {};' });
    const html = await (await get('/__wxa__/appservice.html')).text();
    expect(html).not.toContain('wxa.setup.js');
  });
});
