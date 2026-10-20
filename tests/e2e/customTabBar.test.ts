/**
 * 端到端：自定义 tabBar，运行 examples/custom-tabbar（官方文档的示例代码）
 *
 * 基础库按固定路径 custom-tab-bar/index 创建 tabBar，各版本的创建方式不同，本机有哪个已验证版本就测哪个。
 */

import path from 'path';
import { Frame } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../helpers';
import { e2eReady, expectText, installedBaseLibs, Runner, startRunner, VERIFIED_BASELIBS } from './runner';

const tab = (pagePath: string) => `wx-tab-bar-wrapper [data-path="/${pagePath}"]`;

// 官方示例里选中项用 _HL 图标
const SELECTED_TAB = 'wx-tab-bar-wrapper [data-path]:has(wx-cover-image[src$="_HL.png"])';

async function expectSelectedTab(frame: Frame, text: string) {
  await expectText(frame, SELECTED_TAB, text);
  expect(await frame.locator(SELECTED_TAB).count()).toBe(1);
}

describe.skipIf(!e2eReady)('自定义 tabBar', () => {
  for (const version of VERIFIED_BASELIBS) {
    describe.skipIf(!installedBaseLibs.has(version))(`基础库 ${version}`, () => {
      let runner: Runner;
      const logs: string[] = [];

      const currentFrame = async (): Promise<Frame> => {
        const { frameName } = (await runner.page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
        return runner.page.frame({ name: frameName })!;
      };
      const waitForPage = (pagePath: string) =>
        runner.page.evaluate(p => window.__wxa_test_api__.waitForPage(p), pagePath);

      beforeAll(async () => {
        runner = await startRunner(path.join(EXAMPLES, 'custom-tabbar'), { baseLibVersion: version });
        // 手机外壳按 1:1 显示，720 高的默认视口里底部的 tabBar 在可视区域外，点不到
        await runner.page.setViewportSize({ width: 1280, height: 1000 });
        runner.page.on('console', message => logs.push(message.text()));
      });

      afterAll(async () => {
        await runner?.close();
      });

      it('tab 页显示 custom-tab-bar 渲染的 tabBar，不显示原生 tabBar', async () => {
        const frame = await runner.open('/');
        await frame.waitForSelector(tab('index/index2'));

        expect(await frame.textContent(tab('index/index'))).toBe('组件');
        expect(await frame.textContent(tab('index/index2'))).toBe('接口');
        await expectSelectedTab(frame, '组件');
        expect(await runner.page.isVisible('.wxa-tabbar')).toBe(false);
      });

      it('点击 tabBar 切换页面，页面在 onShow 里用 getTabBar() 更新选中态', async () => {
        await (await runner.open('/')).click(tab('index/index2'));
        await waitForPage('index/index2');
        await expectSelectedTab(await currentFrame(), '接口');

        // 离开首页时 switchTab 已把首页那个实例改成选中「接口」，回来后要靠 onShow 改回「组件」
        await (await currentFrame()).click(tab('index/index'));
        await waitForPage('index/index');
        await expectSelectedTab(await currentFrame(), '组件');
      });

      it('非 tab 页面不显示 tabBar，返回后恢复', async () => {
        logs.length = 0;
        await (await runner.open('/')).click('#to-detail');
        await waitForPage('detail/detail');
        const detail = await currentFrame();
        await detail.waitForSelector('#detail');
        expect(await detail.locator('wx-tab-bar-wrapper [data-path]').count()).toBe(0);

        await runner.page.click('.wxa-navbar-back');
        await waitForPage('index/index');
        await expectSelectedTab(await currentFrame(), '组件');
        expect(logs.filter(log => log.includes('尚未实现'))).toEqual([]);
        expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
      });
    });
  }
});
