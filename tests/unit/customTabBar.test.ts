import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AppBuilder } from '../../packages/core/src/project/AppBuilder';
import { MiniProgram } from '../../packages/core/src/project/MiniProgram';
import { createProject, EXAMPLES, hasToolchain } from '../helpers';

const example = path.join(EXAMPLES, 'custom-tabbar');
const exampleApp = JSON.parse(fs.readFileSync(path.join(example, 'app.json'), 'utf8'));

describe('自定义 tabBar 隐式组件入口', () => {
  it('不经 usingComponents 声明，也收集 tabBar 及其递归组件', () => {
    const project = new MiniProgram(example);
    const app = project.readAppJson();
    expect(project.collectUnits(app)).toEqual({
      pages: app.pages,
      components: ['custom-tab-bar/index', 'components/tab-label/index']
    });
    expect(project.readUnitJson(app.pages[0], app).usingComponents).toEqual({});
  });

  it('组件存在普通引用和循环引用时不重复收集', () => {
    const project = new MiniProgram(createProject({
      'app.json': exampleApp,
      'custom-tab-bar/index.json': {
        component: true,
        usingComponents: { 'tab-label': '/components/tab-label/index' }
      },
      'pages/home/index.json': { usingComponents: { tab: '/custom-tab-bar/index' } },
      'components/tab-label/index.json': {
        component: true,
        usingComponents: { tab: '/custom-tab-bar/index' }
      }
    }));
    expect(project.collectUnits(project.readAppJson()).components).toEqual([
      'custom-tab-bar/index', 'components/tab-label/index'
    ]);
  });

  it('未启用 custom 时不加载目录中遗留的自定义 tabBar', () => {
    const app = exampleApp;
    const project = new MiniProgram(createProject({
      'custom-tab-bar/index.json': { component: true },
      'app.json': { ...app, tabBar: { ...app.tabBar, custom: false } }
    }));
    expect(project.collectUnits(project.readAppJson()).components).toEqual([]);
  });

  it('tabBar 同时出现在 pages 时只注册一次，仍收集其子组件', () => {
    const project = new MiniProgram(createProject({
      'app.json': { ...exampleApp, pages: [...exampleApp.pages, 'custom-tab-bar/index'] },
      'custom-tab-bar/index.json': {
        component: true,
        usingComponents: { 'tab-label': '/components/tab-label/index' }
      },
      'components/tab-label/index.json': { component: true }
    }));
    const { pages, components } = project.collectUnits(project.readAppJson());
    expect([...pages, ...components].filter(id => id === 'custom-tab-bar/index')).toHaveLength(1);
    expect(components).toEqual(['components/tab-label/index']);
  });

  it('按 miniprogramRoot 查找入口，不生成不存在的组件', () => {
    const project = new MiniProgram(createProject({
      'project.config.json': { miniprogramRoot: 'dist/' },
      'dist/app.json': exampleApp,
      'dist/custom-tab-bar/index.json': { component: true }
    }));
    expect(project.collectUnits(project.readAppJson()).components).toContain('custom-tab-bar/index');

    const missing = new MiniProgram(createProject({ 'app.json': exampleApp }));
    expect(missing.collectUnits(missing.readAppJson()).components).toEqual([]);
  });
});

describe.skipIf(!hasToolchain())('自定义 tabBar 构建注册', () => {
  it('通过既有组件链路注册两层模板、样式和逻辑模块，保留 custom 配置', async () => {
    const build = await new AppBuilder(new MiniProgram(example)).build();
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
