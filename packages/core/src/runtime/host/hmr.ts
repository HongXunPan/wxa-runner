/**
 * 热更新：不刷新宿主，应用模板和页面逻辑的改动，保留页面状态（哪些改动能热更新见 server/hmr.ts）
 *
 * 借助基础库为开发者工具准备的接口 __virtualDOM__.updateWxAppCode（开关见 server/html.ts）：
 * - 模板：按模板路径更新，基础库用实例当前的 data 重新渲染
 * - Page() 构造的页面：不走基础库按 .js 路径的更新——那会重新挂载页面（onUnload → onLoad），data 回到初始值。
 *   这里把新方法换到活着的页面实例上，再重新注册 Page，之后新打开的页面用新代码
 * - Component() 构造的页面和组件（uni-app 的页面也是）：状态常在框架自己的实例里（如 Vue 的 setup），
 *   换方法保不住，交给基础库按 .js 路径重新挂载这些实例；页面栈、globalData、其他页面不受影响
 */

import type { Host } from './Host';

export interface HotUpdate {
  version: number;
  templates: string[];
  scripts: string[];
}

/**
 * @throws 拿不到新代码、新代码执行出错、模块没有调用 Page() / Component() 等无法热更新的情况；调用方应整页刷新
 */
export async function applyHotUpdate(host: Host, update: HotUpdate): Promise<void> {
  const hasTemplates = update.templates.length > 0;
  const v = `?v=${update.version}`;
  const [pageTemplates, serviceTemplates, moduleScripts] = await Promise.all([
    hasTemplates ? fetchText(`/__wxa__/page-templates.js${v}`) : '',
    hasTemplates ? fetchText(`/__wxa__/service-templates.js${v}`) : '',
    Promise.all(update.scripts.map(id => fetchText(`/__wxa__/module/${encodeURI(id)}.js${v}`)))
  ]);

  // 与路由串行：跳转进行到一半时页面列表和实例都不稳定
  await host.enqueueRoute(async () => {
    const service = host.serviceWindow() as any;
    if (!service?.__virtualDOM__?.updateWxAppCode) throw new Error('基础库的热更新开关没有打开');

    if (hasTemplates) {
      // 渲染层先换上新模板，逻辑层随后发出的重新渲染指令才能对上
      for (const page of host.livePages()) {
        if (page.win) updateTemplates(page.win as any, pageTemplates, update.templates);
      }
      updateTemplates(service, serviceTemplates, update.templates);
    }

    update.scripts.forEach((id, index) => updateScript(service, host, id, moduleScripts[index]));
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

/** 每次热更新的模块 id 都不同：同一个构建版本也可能被应用两次 */
let hotModuleSeq = 0;

function updateScript(service: any, host: Host, id: string, moduleScript: string) {
  // 基础库忽略对已有模块的重复 define，新代码换个同目录的模块 id 执行：相对路径的 require 解析结果不变，
  // 它依赖的模块直接取缓存，不会重新执行
  const registration = loadModule(service, moduleScript, `${id}.hot-${++hotModuleSeq}.js`);
  if (!registration) throw new Error(`${id}.js 没有调用 Page() 或 Component()，无法热更新`);

  if (registration.constructor === service.Page) {
    for (const page of host.livePages()) {
      if (page.path !== id) continue;
      const instance = service.__virtualDOM__.getRootNode(page.id)?.__methodCaller;
      if (!instance) throw new Error(`找不到页面 ${id}（webviewId ${page.id}）的实例`);
      swapMethods(instance, registration.options);
    }
    register(service, id, registration);
    return;
  }

  // 回调由基础库在注册时登记；没被调用说明没登记上，这次更新不会生效
  let registered = false;
  service.__virtualDOM__.updateWxAppCode(`${id}.js`, () => {
    register(service, id, registration);
    registered = true;
  });
  if (!registered) throw new Error(`基础库没有登记 ${id}.js 的热更新回调`);
}

interface Registration {
  constructor: (options: Record<string, any>) => unknown;
  options: Record<string, any>;
}

/** 按 bootstrap 里 require 页面和组件时的方式设置当前文件，再真正注册 */
function register(service: any, id: string, { constructor, options }: Registration) {
  service.__wxRoute = id;
  service.__wxRouteBegin = true;
  service.__wxAppCurrentFile__ = id + '.js';
  constructor(options);
}

/**
 * 以新模块 id 执行模块，拦下 Page() / Component() 的参数而不注册
 *
 * 逻辑层的 define 不可改写，这里把模块脚本包进以 define 为参数的函数来取出模块函数。
 * Page / Component 要改全局：uni-app 等框架在自己的 vendor 模块里调用它们，包一层参数拦不到
 */
function loadModule(service: any, script: string, hotId: string): Registration | undefined {
  let factory: unknown;
  service.eval(`(function (define) {\n${script}\n})`)((_id: string, fn: unknown) => {
    factory = fn;
  });
  if (typeof factory !== 'function') throw new Error('模块脚本没有 define 模块');
  service.define(hotId, factory);

  const { Page, Component } = service;
  let registration: Registration | undefined;
  service.Page = (options: Record<string, any>) => {
    registration = { constructor: Page, options };
  };
  service.Component = (options: Record<string, any>) => {
    registration = { constructor: Component, options };
  };
  try {
    if (service.Page === Page || service.Component === Component) throw new Error('无法拦截 Page / Component');
    service.require(hotId);
  } finally {
    service.Page = Page;
    service.Component = Component;
  }
  return registration;
}

/**
 * 方法一律换新；data 和其他非函数字段（如 pageSize）可能已被运行时改过，属于状态：
 * 已有的保持不动，只补上新增的，改了初始值的对当前实例不生效
 */
function swapMethods(instance: any, definition: Record<string, any>) {
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value;
    else if (key !== 'data' && !(key in instance)) instance[key] = value;
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
