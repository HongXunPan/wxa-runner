/**
 * 宿主页面入口（打包为 /__wxa__/runtime/host.js）
 */

import type { AppInfo } from '../types';
import { Host, LaunchTarget } from './Host';
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

  await host.start(launchTarget(info));
  markReady();
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

/** 文件变化后重新加载；编译出错时显示错误 */
function connectDevServer() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/__wxa__/ws`);
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'reload') location.reload();
    if (message.type === 'error') {
      const host = (window as any).__wxaHost as Host | undefined;
      if (host) host.shell.showError(`编译失败\n\n${message.message}`);
      else location.reload();
    }
  };
}

main().catch(error => {
  console.error('[wxa-runner] 启动失败', error);
  document.body.textContent = `wxa-runner 启动失败：${error.message}`;
});
