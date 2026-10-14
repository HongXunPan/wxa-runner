/**
 * 宿主页面入口（打包为 /__wxa__/runtime/host.js）
 */

import type { AppInfo } from '../types';
import { Host, LaunchTarget } from './Host';
import { applyHotUpdate, HotUpdate } from './hmr';
import { applySetup, formatSetupSummary } from './setup';
import { installTestApi } from './testApi';
import { PhoneShell } from './ui/PhoneShell';

async function main() {
  const root = document.getElementById('wxa-root')!;
  const info: AppInfo = await (await fetch('/__wxa__/app-info.json')).json();

  connectDevServer();

  if (info.buildError) {
    new PhoneShell(root, info.device).showError(`编译失败\n\n${info.buildError}`);
    return;
  }

  const host = new Host(info, root);
  (window as any).__wxaHost = host;

  let markReady!: () => void;
  const ready = new Promise<void>(resolve => {
    markReady = resolve;
  });
  installTestApi(host, ready);

  if (info.setup && !(await runSetup(host, info.setup))) return;
  await host.start(launchTarget(info));
  markReady();
}

/**
 * 在逻辑层创建前执行 setup；失败时显示错误并返回 false——带着一半的预置状态启动，
 * 小程序的表现会让人误以为是业务代码的问题
 */
async function runSetup(host: Host, setup: NonNullable<AppInfo['setup']>): Promise<boolean> {
  try {
    if (setup.error) throw new Error(setup.error);
    // 地址是变量：esbuild 不会尝试在打包时解析它
    const url = '/__wxa__/setup.js';
    const module = await import(url);
    console.info(formatSetupSummary(await applySetup(module.default, host, setup.env)));
    return true;
  } catch (error) {
    console.error('[wxa-runner] setup 执行失败', error);
    host.shell.showError(`setup 执行失败\n\n${(error as Error).message}`);
    return false;
  }
}

/** ?path=pages/detail/detail&id=1 可以直接打开指定页面 */
function launchTarget(info: AppInfo): LaunchTarget {
  const params = new URLSearchParams(location.search);
  const path = (params.get('path') || '').replace(/^\//, '').replace(/\.html$/, '');
  params.delete('path');
  if (path && info.pages.includes(path)) {
    return { path, query: Object.fromEntries(params) };
  }
  const entry = String(info.wxConfig.entryPagePath || info.pages[0]).replace(/\.html$/, '');
  return { path: entry, query: {} };
}

/** 文件变化后热更新或整页刷新；编译出错时显示错误 */
function connectDevServer() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/__wxa__/ws`);
  // 连续保存时按顺序应用
  let hotChain = Promise.resolve();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'reload') location.reload();
    if (message.type === 'hot') hotChain = hotChain.then(() => hotUpdate(message));
    if (message.type === 'error') {
      const host = (window as any).__wxaHost as Host | undefined;
      if (host) host.shell.showError(`编译失败\n\n${message.message}`);
      else location.reload();
    }
  };
}

async function hotUpdate(update: HotUpdate) {
  const host = (window as any).__wxaHost as Host | undefined;
  const files = [...update.templates.map(id => id + '.wxml'), ...update.pages.map(id => id + '.js')].join(', ');
  try {
    if (!host) throw new Error('宿主尚未启动');
    await applyHotUpdate(host, update);
    console.info(`[wxa-runner] 热更新完成：${files}`);
  } catch (error) {
    console.warn(`[wxa-runner] ${files} 无法热更新，整页刷新：`, error);
    location.reload();
  }
}

main().catch(error => {
  console.error('[wxa-runner] 启动失败', error);
  document.body.textContent = `wxa-runner 启动失败：${error.message}`;
});
