/**
 * 把小程序项目构建成官方基础库能直接加载的形式
 *
 * 逻辑层（appservice）:
 *   1. 裁剪版 $gwx（wcc -xc），基础库用它了解组件的节点结构
 *   2. 每个 JS 文件单独一个 define("x.js", fn) 脚本（便于在 DevTools 里按原文件调试）
 *   3. bootstrap：注册 __wxAppCode__ 的 json/wxml，require("app.js")，再依次 require 组件和页面
 *
 * 渲染层（page-frame）:
 *   1. 完整版 $gwx（wcc -cc）
 *   2. wcsc 的公共样式运行时 + app.wxss
 *   3. 每个页面/组件的 __wxAppCode__ json / wxml / wxss
 */

import { compileWxml, compileWxss, ComponentTags } from '@open-wxa/wxa-runner-compiler';
import { transformSync } from 'esbuild';
import { AppJson, MiniProgram } from './MiniProgram';
import { createWxConfig } from './wxConfig';

export interface BuildResult {
  version: number;
  wxConfig: Record<string, any>;
  /** 所有 JS 模块 id（如 "pages/index/index.js"），逻辑层按此顺序加载 define 脚本 */
  modules: string[];
  serviceBootstrap: string;
  pageFrame: string;
  pages: string[];
  components: string[];
  durationMs: number;
}

/** define 包装函数的参数：屏蔽浏览器全局对象，与开发者工具一致 */
const MODULE_PARAMS = [
  'require', 'module', 'exports', 'window', 'document', 'frames', 'self', 'location', 'navigator',
  'localStorage', 'history', 'Caches', 'screen', 'alert', 'confirm', 'prompt', 'XMLHttpRequest',
  'WebSocket', 'Reporter', 'webkit', 'WeixinJSCore'
].join(', ');

/** 行首的 import / export 语句（不匹配 import() 动态导入） */
const ESM_SYNTAX = /^\s*(import\s*[\w*{'"]|export\s+(default|const|let|var|function|class|async|\{|\*))/m;

type ChangeKind = 'config' | 'wxml' | 'wxss' | 'js';

export class AppBuilder {
  private version = 0;
  private pending: Promise<BuildResult> | null = null;
  private last: BuildResult | null = null;
  private dirty = new Set<ChangeKind>(['config', 'wxml', 'wxss', 'js']);
  private wxmlCache: { full: string; cut: string } | null = null;
  private wxssCache: { comm: string; pages: Record<string, string> } | null = null;

  constructor(readonly project: MiniProgram) {}

  /** 根据变化的文件标记需要重新构建的部分；返回 true 表示需要刷新 */
  invalidate(changedFiles: string[] = []): boolean {
    if (changedFiles.length === 0) {
      ['config', 'wxml', 'wxss', 'js'].forEach(kind => this.dirty.add(kind as ChangeKind));
      return true;
    }

    let relevant = false;
    for (const file of changedFiles) {
      const kind = classifyFile(file);
      if (!kind) continue;
      relevant = true;
      this.dirty.add(kind);
      // json 决定组件关系，wxml/wxss 的编译参数都依赖它
      if (kind === 'config') {
        this.dirty.add('wxml');
        this.dirty.add('wxss');
      }
    }
    return relevant;
  }

  build(): Promise<BuildResult> {
    if (this.dirty.size === 0 && this.last) return Promise.resolve(this.last);
    if (!this.pending) {
      this.pending = this.doBuild().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  /**
   * 单个 JS 模块的 define 包装
   *
   * 包装头和代码第一行写在同一行，行号与源文件一致。使用 import/export 的文件
   * 先转换为 CommonJS（对应开发者工具的「ES6 转 ES5」），并内联 source map。
   */
  getModuleScript(id: string): string {
    let code = this.project.readText(id);
    if (ESM_SYNTAX.test(code)) {
      try {
        code = transformSync(code, {
          format: 'cjs',
          loader: 'js',
          target: 'es2020',
          sourcefile: id,
          sourcemap: 'inline'
        }).code;
      } catch (error) {
        const message = `[wxa-runner] ${id} 转换失败：${(error as Error).message}`;
        return `console.error(${JSON.stringify(message)});\n`;
      }
    }
    return `define(${JSON.stringify(id)}, function(${MODULE_PARAMS}){${code}\n});\n`;
  }

  private async doBuild(): Promise<BuildResult> {
    const start = Date.now();
    const dirty = new Set(this.dirty);
    this.dirty.clear();

    try {
      const app = this.project.readAppJson();
      const { pages, components } = this.project.collectUnits(app);
      const units = [...components, ...pages];
      const unitJson = new Map(units.map(id => [id, this.project.readUnitJson(id, app)]));

      const [wxml, wxss] = await Promise.all([
        dirty.has('wxml') || !this.wxmlCache ? this.compileTemplates(units, unitJson) : this.wxmlCache,
        dirty.has('wxss') || !this.wxssCache ? this.compileStyles(units) : this.wxssCache
      ]);
      this.wxmlCache = wxml;
      this.wxssCache = wxss;

      const workersDir = typeof app.workers === 'string' ? app.workers : app.workers?.path;
      const modules = this.project.listFiles(['.js'], workersDir ? [workersDir] : []);

      const result: BuildResult = {
        version: ++this.version,
        wxConfig: createWxConfig({
          app,
          pages,
          unitJson,
          appid: this.project.appid,
          subPackages: this.project.subPackages(app)
        }),
        modules,
        serviceBootstrap: this.createServiceBootstrap(app, units, unitJson, wxml.cut, modules),
        pageFrame: this.createPageFrame(app, units, unitJson, wxml.full, wxss),
        pages,
        components,
        durationMs: Date.now() - start
      };
      this.last = result;
      return result;
    } catch (error) {
      // 构建失败时保留脏标记，下次请求重新尝试
      dirty.forEach(kind => this.dirty.add(kind));
      throw error;
    }
  }

  private async compileTemplates(units: string[], unitJson: Map<string, any>) {
    const files = this.project.listFiles(['.wxml', '.wxs']).map(f => './' + f);
    const components: ComponentTags[] = units
      .filter(id => this.project.exists(id + '.wxml'))
      .map(id => {
        const json = unitJson.get(id);
        return { path: id, tags: Object.keys({ ...json.usingComponents, ...(json.componentGenerics || {}) }) };
      });

    const cwd = this.project.root;
    const [full, cut] = await Promise.all([
      compileWxml({ cwd, files, components, cut: false }),
      compileWxml({ cwd, files, components, cut: true })
    ]);
    return { full, cut };
  }

  private compileStyles(units: string[]) {
    return compileWxss({
      cwd: this.project.root,
      pageFiles: units.filter(id => this.project.exists(id + '.wxss')).map(id => `./${id}.wxss`),
      commonFiles: this.project.exists('app.wxss') ? ['./app.wxss'] : []
    });
  }

  private createServiceBootstrap(
    app: AppJson,
    units: string[],
    unitJson: Map<string, any>,
    cutGwx: string,
    modules: string[]
  ): string {
    const lines: string[] = [cutGwx, `__wxAppCode__["app.json"] = ${toJs(app)};`];

    for (const id of units) {
      lines.push(`__wxAppCode__[${toJs(id + '.json')}] = ${toJs(unitJson.get(id))};`);
      if (this.project.exists(id + '.wxml')) {
        lines.push(`__wxAppCode__[${toJs(id + '.wxml')}] = $gwx(${toJs('./' + id + '.wxml')});`);
      }
    }

    if (modules.includes('app.js')) {
      lines.push(requireStatement('app.js', null));
    }
    for (const id of units) {
      if (modules.includes(id + '.js')) lines.push(requireStatement(id + '.js', id));
    }
    return lines.join('\n');
  }

  private createPageFrame(
    app: AppJson,
    units: string[],
    unitJson: Map<string, any>,
    fullGwx: string,
    wxss: { comm: string; pages: Record<string, string> }
  ): string {
    const lines: string[] = [fullGwx, wxss.comm, `__wxAppCode__["app.json"] = ${toJs(app)};`];

    for (const id of units) {
      lines.push(`__wxAppCode__[${toJs(id + '.json')}] = ${toJs(unitJson.get(id))};`);
      if (this.project.exists(id + '.wxml')) {
        lines.push(`__wxAppCode__[${toJs(id + '.wxml')}] = $gwx(${toJs('./' + id + '.wxml')});`);
      }
      const css = wxss.pages[id + '.wxss'];
      if (css) lines.push(`__wxAppCode__[${toJs(id + '.wxss')}] = ${css};`);
    }
    return lines.join('\n');
  }
}

/** 某个模块执行出错时只影响它自己，其余页面照常注册 */
function requireStatement(file: string, route: string | null): string {
  const routeSetup = route
    ? `__wxRoute = ${toJs(route)}; __wxRouteBegin = true; __wxAppCurrentFile__ = ${toJs(file)};`
    : `__wxAppCurrentFile__ = ${toJs(file)};`;
  return `${routeSetup}\ntry { require(${toJs(file)}); } catch (error) { console.error(${toJs('[wxa-runner] ' + file + ' 执行出错\n')}, error); }`;
}

/** JSON 序列化并转义 </script> 与行分隔符，结果可安全嵌入脚本 */
export function toJs(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function classifyFile(file: string): ChangeKind | null {
  if (file.endsWith('.json')) return 'config';
  if (file.endsWith('.wxml') || file.endsWith('.wxs')) return 'wxml';
  if (file.endsWith('.wxss')) return 'wxss';
  if (file.endsWith('.js')) return 'js';
  return null;
}
