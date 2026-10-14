/**
 * 热更新的分流：哪些改动能热更新，哪些必须整页刷新
 */

import { describe, expect, it } from 'vitest';
import { planHotUpdate } from '../../packages/core/src/server/hmr';

const units = { pages: ['pages/index/index', 'pages/detail/detail'], components: ['components/badge/badge'] };

describe('热更新分流', () => {
  it('页面和组件自己的 WXML 改动走模板热更新', () => {
    expect(planHotUpdate(['pages/index/index.wxml', 'components/badge/badge.wxml'], units)).toEqual({
      templates: ['pages/index/index', 'components/badge/badge'],
      pages: []
    });
  });

  it('页面 JS 改动走逻辑热更新', () => {
    expect(planHotUpdate(['pages/detail/detail.js'], units)).toEqual({ templates: [], pages: ['pages/detail/detail'] });
  });

  it('同一次保存里页面的 WXML 和 JS 一起热更新', () => {
    expect(planHotUpdate(['pages/index/index.wxml', 'pages/index/index.js'], units)).toEqual({
      templates: ['pages/index/index'],
      pages: ['pages/index/index']
    });
  });

  it('同一个文件连续变化只更新一次', () => {
    expect(planHotUpdate(['pages/index/index.js', 'pages/index/index.js'], units)).toEqual({
      templates: [],
      pages: ['pages/index/index']
    });
  });

  it.each([
    ['app.js', 'App 只在启动时执行'],
    ['app.json', '配置决定页面和组件结构'],
    ['pages/index/index.json', '配置决定页面和组件结构'],
    ['components/badge/badge.js', '组件逻辑热更新尚未支持'],
    ['utils/format.js', '普通模块要沿依赖图更新，尚未支持'],
    ['utils/format.wxs', 'wxs 会被多个模板引用'],
    ['templates/item.wxml', '被 import / include 的模板会影响多个页面'],
    ['pages/index/index.wxss', '样式热更新尚未支持'],
    ['wxa.setup.js', 'setup 必须在启动前执行'],
    ['../wxa.setup.ts', 'setup 必须在启动前执行']
  ])('%s 改动需要整页刷新（%s）', file => {
    expect(planHotUpdate([file], units)).toBeNull();
  });

  it('一次保存里只要有一个文件不能热更新，就整页刷新', () => {
    expect(planHotUpdate(['pages/index/index.wxml', 'app.js'], units)).toBeNull();
  });
});
