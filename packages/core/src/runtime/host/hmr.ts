/**
 * 热更新：不刷新宿主，应用模板和页面逻辑的改动，保留页面状态（哪些改动能热更新见 server/hmr.ts）
 *
 * 借助基础库为开发者工具准备的接口 __virtualDOM__.updateWxAppCode（开关见 server/html.ts）：
 * - 模板：按模板路径更新，基础库用实例当前的 data 重新渲染
 * - 页面逻辑：不走基础库按 .js 路径的更新——那会重新挂载页面（onUnload → onLoad），data 回到初始值。
 *   这里把新方法换到活着的页面实例上，再重新注册 Page，之后新打开的页面用新代码
 */

import type { Host } from './Host';

export interface HotUpdate {
  version: number;
  templates: string[];
  pages: string[];
}

/**
 * @throws 拿不到新代码、新代码执行出错、页面不是用 Page() 构造等无法热更新的情况；调用方应整页刷新
 */
export async function applyHotUpdate(host: Host, update: HotUpdate): Promise<void> {
  const hasTemplates = update.templates.length > 0;
  const v = `?v=${update.version}`;
  const [pageFrame, serviceTemplates, moduleScripts] = await Promise.all([
    hasTemplates ? fetchText(`/__wxa__/page-frame.js${v}`) : '',
    hasTemplates ? fetchText(`/__wxa__/service-templates.js${v}`) : '',
    Promise.all(update.pages.map(id => fetchText(`/__wxa__/module/${encodeURI(id)}.js${v}`)))
  ]);

  // 与路由串行：跳转进行到一半时页面列表和实例都不稳定
  await host.enqueueRoute(async () => {
    const service = host.serviceWindow() as any;
    if (!service?.__virtualDOM__?.updateWxAppCode) throw new Error('基础库的热更新开关没有打开');

    if (hasTemplates) {
      // 渲染层先换上新模板，逻辑层随后发出的重新渲染指令才能对上
      for (const page of host.livePages()) {
        if (page.win) updateTemplates(page.win as any, pageFrame, update.templates);
      }
      updateTemplates(service, serviceTemplates, update.templates);
    }

    update.pages.forEach((id, index) => updatePageLogic(service, host, id, moduleScripts[index], update.version));
  });
}

function updateTemplates(win: any, code: string, units: string[]) {
  // wcc 生成的模板把编译结果缓存在 __WXML_GLOBAL__ 上，不清掉的话新代码会读到旧缓存。
  // 保留 wxs_nf_init：WXS 运行时只能初始化一次，重复执行会因改写内置对象原型而报错
  const cache = win.__WXML_GLOBAL__;
  if (cache) Object.assign(cache, { ops_cached: {}, ops_set: {}, ops_init: {}, debuginfo_set: {}, modules: {} });
  win.eval(code);

  for (const id of units) {
    const generate = win.__wxAppCode__[id + '.wxml'];
    if (generate) win.__virtualDOM__.updateWxAppCode(id + '.wxml', generate);
  }
}

function updatePageLogic(service: any, host: Host, id: string, moduleScript: string, version: number) {
  // 基础库忽略对已有模块的重复 define，新代码换个同目录的模块 id 执行：相对路径的 require 解析结果不变，
  // 它依赖的模块直接取缓存，不会重新执行
  const hotId = `${id}.hot-${version}.js`;
  const { definition } = loadPageModule(service, moduleScript, hotId);
  if (!definition) throw new Error(`${id}.js 没有调用 Page()，无法热更新`);

  for (const page of host.livePages()) {
    if (page.path !== id) continue;
    const instance = service.__virtualDOM__.getRootNode(page.id)?.__methodCaller;
    if (!instance) throw new Error(`找不到页面 ${id}（webviewId ${page.id}）的实例`);
    swapMethods(instance, definition);
  }

  service.__wxRoute = id;
  service.__wxRouteBegin = true;
  service.__wxAppCurrentFile__ = id + '.js';
  service.Page(definition);
}

/**
 * 以新模块 id 执行页面模块，拦下 Page() 的参数而不注册
 *
 * 逻辑层的 define 不可改写，这里把模块脚本包进以 define、Page 为参数的函数：
 * 脚本里定义的模块函数闭包引用的就是这两个参数，不用动全局对象
 */
function loadPageModule(service: any, script: string, hotId: string) {
  let factory: unknown;
  let definition: Record<string, any> | undefined;
  const load = service.eval(`(function (define, Page) {\n${script}\n})`);
  load(
    (_id: string, fn: unknown) => {
      factory = fn;
    },
    (options: Record<string, any>) => {
      definition = options;
    }
  );
  if (typeof factory !== 'function') throw new Error('模块脚本没有 define 模块');
  service.define(hotId, factory);
  service.require(hotId);
  return { definition };
}

/** 已有的 data 保持不动，只补上新增的字段；改了初始值的字段对当前实例不生效 */
function swapMethods(instance: any, definition: Record<string, any>) {
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value;
  }
  const data = definition.data || {};
  const added = Object.keys(data).filter(key => !(key in instance.data));
  if (added.length) instance.setData(Object.fromEntries(added.map(key => [key, data[key]])));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.text();
}
