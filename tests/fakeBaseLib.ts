/**
 * 模拟的新版基础库（隔离上下文），用于在没有新版基础库的机器（如 CI）上测试 runtime/context.ts
 *
 * 只实现 wxa-runner 依赖的那部分原生接口约定，行为取自 3.8.8 的 WAServiceMainContext.js / WASubContext.js：
 * - 主上下文初始化时取走 WeixinJSContext 上的方法、再删掉它们，之后只通过取走的引用调用
 * - 主上下文创建名为 app 的子上下文，收到原生事件 onSubPackageReady 后执行业务入口 app-service.js
 * - 子上下文注册到同一个 WeixinJSContext 对象上，提供 define / require / App / Page / getCurrentPages
 *
 * lazyLibFiles 另外模拟渲染层按需加载基础库文件，行为取自 3.5.8 的 WAWebview.js。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { packWxvpkg } from './helpers';

const takeNativeInterface = `
  var ctx = WeixinJSContext, native = {};
  Object.keys(ctx).forEach(function (key) { native[key] = ctx[key]; delete ctx[key]; });
  delete globalThis.WeixinJSContext;
  ctx.register = function () {};
  ctx.subscribeHandler = function () {};
`;

const mainContext = (body: string) => `(function () {${takeNativeInterface}${body}\n})();`;

const SUB_CONTEXT = `(function (g) {
  var ctx = g.WeixinJSContext;
  ctx.register(ctx, { subscribeHandler: function () {} }, g.WeixinJSContextId);
  delete g.WeixinJSContext;
  delete g.WeixinJSContextId;
  var factories = {}, modules = {}, pages = [];
  g.define = function (id, factory) { factories[id] = factory; };
  g.require = function (id) {
    if (!modules[id]) {
      modules[id] = { exports: {} };
      factories[id](g.require, modules[id], modules[id].exports);
    }
    return modules[id].exports;
  };
  g.App = function () {};
  g.Component = function () {};
  g.Page = function (options) { pages.push({ route: g.__wxRoute, data: options.data || {} }); };
  g.getCurrentPages = function () { return pages.slice(); };
})(this);`;

const EVALUATE_APP_SERVICE = mainContext(`
  var app = native.alloc.call(ctx, 'app');
  WeixinJSBridge.on('onSubPackageReady', function () {
    native.evaluateScriptFile.call(ctx, app, '/app-service.js', function () {});
  });`);

/** 渲染层只要有 __wxAppCode__ 就能注册模板和样式 */
const WEBVIEW = 'var __wxAppCode__ = {};';

/** 版本号 → 主上下文和渲染层的行为 */
export const FAKE_BASELIBS = {
  /** 与 3.8.8 一致：带回调的 evaluateScriptFile 执行业务入口 */
  evaluateScriptFile: {
    version: '9.0.0',
    main: EVALUATE_APP_SERVICE
  },
  /** 按需注入的做法：在开发者工具平台上同步调用 loadJsFiles，不带回调 */
  loadJsFiles: {
    version: '9.0.1',
    main: mainContext(`
      var app = native.alloc.call(ctx, 'app');
      WeixinJSBridge.on('onSubPackageReady', function () {
        native.loadJsFiles.call(ctx, app, JSON.stringify(['/app-service.js']));
      });`)
  },
  /** 基础库没有创建业务子上下文（如 __wxConfig 不符合它的预期） */
  noAppContext: {
    version: '9.0.2',
    main: mainContext('')
  },
  /**
   * 3.3.x、3.5.x 的 video 等组件放在单独的文件里，渲染层用到时在开发者工具平台上同步调用 loadLibFilesSync：
   * 脚本要在调用返回前执行完（基础库在调用前后设置、清理 window.__Behaviour 等全局变量），CSS 从回调的 __codes 取
   */
  lazyLibFiles: {
    version: '9.0.3',
    main: EVALUATE_APP_SERVICE,
    webview: `${WEBVIEW}
      WeixinJSBridge.invoke('loadLibFilesSync', { paths: ['WALazyComponent.js', 'WALazyComponent.css'] }, function (res) {
        window.__lazyCodes = res.__codes;
      });
      window.__lazyRunsWhenReturned = window.__lazyRuns;`,
    files: {
      '/WALazyComponent.js': 'window.__lazyRuns = (window.__lazyRuns || 0) + 1;',
      '/WALazyComponent.css': '.lazy { color: red; }'
    }
  }
} as const;

/** 生成放着全部模拟基础库的 WeappVendor 目录，配合 WXA_VENDOR_DIR 使用 */
export function createFakeVendorDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-fake-vendor-'));
  for (const lib of Object.values(FAKE_BASELIBS)) {
    fs.writeFileSync(path.join(dir, `${lib.version}.wxvpkg`), packWxvpkg({
      '/WAServiceMainContext.js': lib.main,
      '/WASubContext.js': SUB_CONTEXT,
      '/WAWebview.js': 'webview' in lib ? lib.webview : WEBVIEW,
      ...('files' in lib ? lib.files : {})
    }));
  }
  return dir;
}
