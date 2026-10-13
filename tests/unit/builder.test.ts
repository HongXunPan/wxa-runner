import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AppBuilder, toJs } from '../../packages/core/src/project/AppBuilder';
import { MiniProgram } from '../../packages/core/src/project/MiniProgram';
import { createProject, hasDevtools } from '../helpers';

function demoProject() {
  return createProject({
    'app.json': { pages: ['pages/a/a', 'pages/b/b'], usingComponents: { comp: '/components/comp/comp' } },
    'app.js': 'App({})',
    'app.wxss': 'page { color: #333; }',
    'pages/a/a.json': {},
    'pages/a/a.wxml': '<view>{{msg}}</view><comp/>',
    'pages/a/a.wxss': '.x { margin: 10rpx; }',
    'pages/a/a.js': "const util = require('../../utils/util.js');\nPage({ data: { msg: util.hi() } })",
    'pages/b/b.json': {},
    'pages/b/b.wxml': '<view>b</view>',
    'pages/b/b.js': 'Page({})',
    'components/comp/comp.json': { component: true },
    'components/comp/comp.wxml': '<view>comp</view>',
    'components/comp/comp.js': 'Component({})',
    'utils/util.js': "module.exports = { hi: () => 'hi' }",
    'utils/esm.js': "import { hi } from './util';\nexport const twice = () => hi() + hi();\n",
    'utils/broken-esm.js': 'export const = 1;'
  });
}

describe('JS 模块包装', () => {
  const root = demoProject();
  const builder = new AppBuilder(new MiniProgram(root));

  it('CommonJS 文件原样包进 define，首行与包装头同一行，行号保持一致', () => {
    const script = builder.getModuleScript('pages/a/a.js');
    expect(script.startsWith('define("pages/a/a.js", function(require, module, exports, window, document,')).toBe(true);
    expect(script.split('\n')[1]).toBe('Page({ data: { msg: util.hi() } })');
  });

  it('使用 import/export 的文件转换为 CommonJS，并带 source map', () => {
    const script = builder.getModuleScript('utils/esm.js');
    expect(script).toContain('require("./util")');
    expect(script).not.toMatch(/^\s*import /m);
    expect(script).toContain('sourceMappingURL=data:application/json');
  });

  it('转换失败时输出控制台错误而不是让整个逻辑层崩溃', () => {
    expect(builder.getModuleScript('utils/broken-esm.js')).toMatch(/^console\.error\(".*utils\/broken-esm\.js 转换失败/);
  });
});

describe('toJs', () => {
  it('转义 </script> 和行分隔符，结果仍是等价的 JSON', () => {
    const value = { a: '</script><b>', b: 'x\u2028y\u2029z' };
    const code = toJs(value);
    expect(code).not.toContain('</script>');
    expect(code).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(code)).toEqual(value);
  });
});

describe('增量构建标记', () => {
  const builder = new AppBuilder(new MiniProgram(demoProject()));

  it('只有小程序源文件的变化才需要重新构建', () => {
    expect(builder.invalidate(['images/logo.png'])).toBe(false);
    expect(builder.invalidate(['pages/a/a.js'])).toBe(true);
    expect(builder.invalidate(['pages/a/a.wxss'])).toBe(true);
  });
});

describe.skipIf(!hasDevtools())('完整构建', () => {
  it('生成逻辑层和渲染层需要的全部产物', async () => {
    const root = demoProject();
    const result = await new AppBuilder(new MiniProgram(root)).build();

    expect(result.pages).toEqual(['pages/a/a', 'pages/b/b']);
    expect(result.components).toEqual(['components/comp/comp']);
    expect(result.modules).toEqual(expect.arrayContaining(['app.js', 'pages/a/a.js', 'utils/util.js']));

    // 逻辑层：先注册组件和页面的 json/wxml，再 require app.js，最后按组件→页面顺序 require
    const svc = result.serviceBootstrap;
    expect(svc).toContain('__wxAppCode__["pages/a/a.json"] = {"usingComponents":{"comp":"/components/comp/comp"}}');
    expect(svc.indexOf('require("app.js")')).toBeLessThan(svc.indexOf('require("components/comp/comp.js")'));
    expect(svc.indexOf('require("components/comp/comp.js")')).toBeLessThan(svc.indexOf('require("pages/a/a.js")'));
    expect(svc).toContain('__wxRoute = "pages/a/a"');

    // 渲染层：完整 $gwx、公共样式、每个页面的样式函数
    expect(result.pageFrame).toContain('__wxAppCode__["pages/a/a.wxml"] = $gwx("./pages/a/a.wxml")');
    expect(result.pageFrame).toContain('__wxAppCode__["pages/a/a.wxss"] = setCssToHead');
    expect(result.pageFrame).toContain('color: #333');
    expect(result.wxConfig.entryPagePath).toBe('pages/a/a.html');
  });

  it('文件未变化时复用上次结果，变化后版本号递增', async () => {
    const root = demoProject();
    const builder = new AppBuilder(new MiniProgram(root));
    const first = await builder.build();
    expect(await builder.build()).toBe(first);

    fs.writeFileSync(path.join(root, 'pages/b/b.wxml'), '<view>changed</view>');
    builder.invalidate(['pages/b/b.wxml']);
    const second = await builder.build();
    expect(second.version).toBe(first.version + 1);
    expect(second.pageFrame).toContain('changed');
  });

  it('并发请求共享同一次构建', async () => {
    const builder = new AppBuilder(new MiniProgram(demoProject()));
    const [a, b] = await Promise.all([builder.build(), builder.build()]);
    expect(a).toBe(b);
  });

  it('编译失败时抛出编译器的错误信息，修复后可以重新构建', async () => {
    const root = demoProject();
    const builder = new AppBuilder(new MiniProgram(root));
    fs.writeFileSync(path.join(root, 'pages/b/b.wxml'), '<view>');
    await expect(builder.build()).rejects.toThrow(/pages\/b\/b\.wxml/);

    fs.writeFileSync(path.join(root, 'pages/b/b.wxml'), '<view>ok</view>');
    builder.invalidate(['pages/b/b.wxml']);
    await expect(builder.build()).resolves.toMatchObject({ pages: ['pages/a/a', 'pages/b/b'] });
  });
});
