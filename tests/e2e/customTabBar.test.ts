import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customTabBarFiles } from '../fixtures/customTabBar';
import { e2eReady, Runner, startRunner } from './runner';

describe.skipIf(!e2eReady)('官方基础库自定义 tabBar', () => {
  let runner: Runner;
  const current = () => runner.page.frameLocator('iframe[data-current]');
  const waitForPage = (path: string) => runner.page.evaluate(p => window.__wxa_test_api__.waitForPage(p), path);

  beforeAll(async () => { runner = await startRunner(customTabBarFiles); });
  afterAll(() => runner?.close());

  it('渲染隐式组件及其子组件，getTabBar/setData 更新选中态，点击切换且保留页面实例', async () => {
    await runner.open('/');
    await current().locator('#tab-home').waitFor();
    expect(await current().locator('#tab-home').innerText()).toBe('首页');
    expect(await runner.page.isVisible('.wxa-tabbar')).toBe(false);
    await current().locator('#count').click();
    await current().locator('#tab-mine').click();
    await waitForPage('pages/mine/index');
    await current().locator('#tab-selected').filter({ hasText: '选中：1' }).waitFor();
    await current().locator('#tab-home').click();
    await waitForPage('pages/home/index');
    expect(await current().locator('#count').innerText()).toBe('计数：1');
    expect(await current().locator('#tab-taps').innerText()).toBe('点击：1');
    expect(await current().locator('#tab-selected').innerText()).toBe('选中：0');
  });

  it('非 tab 页面不显示，返回后恢复；没有未捕获错误', async () => {
    await runner.open('/');
    await current().locator('#tab-home').waitFor();
    await current().locator('#detail').click();
    await waitForPage('pages/detail/index');
    expect(await current().locator('#tab-home').count()).toBe(0);
    await current().locator('#back').click();
    await waitForPage('pages/home/index');
    await current().locator('#tab-home').waitFor();
    expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
  });
});
