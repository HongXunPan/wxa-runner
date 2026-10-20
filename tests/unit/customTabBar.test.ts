import path from 'path';
import { describe, expect, it } from 'vitest';
import { AppBuilder } from '../../packages/core/src/project/AppBuilder';
import { MiniProgram } from '../../packages/core/src/project/MiniProgram';
import { createProject, EXAMPLES, hasToolchain } from '../helpers';

const app = {
  pages: ['pages/home/index', 'pages/mine/index'],
  tabBar: {
    custom: true,
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/mine/index', text: '我的' }
    ]
  }
};

/** 自定义 tabBar 引用了一个子组件，页面都没有声明它 */
const files = {
  'app.json': app,
  'pages/home/index.json': {},
  'pages/home/index.wxml': '<view>首页</view>',
  'pages/home/index.js': 'Page({});',
  'pages/mine/index.json': {},
  'pages/mine/index.wxml': '<view>我的</view>',
  'pages/mine/index.js': 'Page({});',
  'custom-tab-bar/index.json': { component: true, usingComponents: { 'tab-label': '/components/tab-label/index' } },
  'custom-tab-bar/index.wxml': '<view class="tabs"><tab-label label="首页" /></view>',
  'custom-tab-bar/index.wxss': '.tabs { position: fixed; bottom: 0; }',
  'custom-tab-bar/index.js': 'Component({});',
  'components/tab-label/index.json': { component: true },
  'components/tab-label/index.wxml': '<view>{{label}}</view>',
  'components/tab-label/index.js': 'Component({ properties: { label: String } });'
};

describe('自定义 tabBar 隐式组件入口', () => {
  it('官方示例：页面不声明 custom-tab-bar 也会收集它', () => {
    const project = new MiniProgram(path.join(EXAMPLES, 'custom-tabbar'));
    const exampleApp = project.readAppJson();
    expect(project.collectUnits(exampleApp)).toEqual({ pages: exampleApp.pages, components: ['custom-tab-bar/index'] });
    expect(project.readUnitJson(exampleApp.pages[0], exampleApp).usingComponents).toEqual({});
  });

  it('递归收集 tabBar 引用的组件，普通引用和循环引用都不重复', () => {
    const project = new MiniProgram(createProject({
      ...files,
      'pages/home/index.json': { usingComponents: { tab: '/custom-tab-bar/index' } },
      'components/tab-label/index.json': { component: true, usingComponents: { tab: '/custom-tab-bar/index' } }
    }));
    expect(project.collectUnits(project.readAppJson()).components).toEqual([
      'custom-tab-bar/index', 'components/tab-label/index'
    ]);
  });

  it('未启用 custom 时不加载目录中遗留的自定义 tabBar', () => {
    const project = new MiniProgram(createProject({ ...files, 'app.json': { ...app, tabBar: { ...app.tabBar, custom: false } } }));
    expect(project.collectUnits(project.readAppJson()).components).toEqual([]);
  });

  it('tabBar 同时写在 pages 里时只注册一次，仍收集它的子组件', () => {
    const project = new MiniProgram(createProject({ ...files, 'app.json': { ...app, pages: [...app.pages, 'custom-tab-bar/index'] } }));
    const { pages, components } = project.collectUnits(project.readAppJson());
    expect([...pages, ...components].filter(id => id === 'custom-tab-bar/index')).toHaveLength(1);
    expect(components).toEqual(['components/tab-label/index']);
  });

  it('按 miniprogramRoot 查找入口，没有 custom-tab-bar 时不生成组件', () => {
    const rooted = Object.fromEntries(Object.entries(files).map(([file, content]) => ['dist/' + file, content]));
    const project = new MiniProgram(createProject({ 'project.config.json': { miniprogramRoot: 'dist/' }, ...rooted }));
    expect(project.collectUnits(project.readAppJson()).components).toContain('custom-tab-bar/index');

    const missing = new MiniProgram(createProject({ 'app.json': app }));
    expect(missing.collectUnits(missing.readAppJson()).components).toEqual([]);
  });
});

describe.skipIf(!hasToolchain())('自定义 tabBar 构建注册', () => {
  it('tabBar 和它的子组件走组件的构建链路：模板、样式、逻辑都注册，且先于页面', async () => {
    const build = await new AppBuilder(new MiniProgram(createProject(files))).build();
    for (const id of ['custom-tab-bar/index', 'components/tab-label/index']) {
      expect(build.serviceBootstrap).toContain(`require("${id}.js")`);
      expect(build.serviceTemplates).toContain(`__wxAppCode__["${id}.json"]`);
      expect(build.serviceTemplates).toContain(`__wxAppCode__["${id}.wxml"]`);
      expect(build.pageTemplates).toContain(`__wxAppCode__["${id}.wxml"]`);
    }
    expect(build.pageStyles).toContain('__wxAppCode__["custom-tab-bar/index.wxss"]');
    expect(build.wxConfig.tabBar.custom).toBe(true);
    expect(build.serviceBootstrap.indexOf('require("custom-tab-bar/index.js")'))
      .toBeLessThan(build.serviceBootstrap.indexOf('require("pages/home/index.js")'));
  });
});
