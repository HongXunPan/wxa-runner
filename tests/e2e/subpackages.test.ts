import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subpackageFiles } from '../fixtures/subpackages';
import { e2eReady, Runner, startRunner } from './runner';

describe.skipIf(!e2eReady)('普通分包的本地就绪语义', () => {
  let runner: Runner;
  const current = () => runner.page.frameLocator('iframe[data-current]');
  const waitText = (selector: string, text: string) => current().locator(selector).filter({ hasText: text }).waitFor();

  beforeAll(async () => { runner = await startRunner(subpackageFiles); });
  afterAll(() => runner?.close());

  it('预加载与原生任务能完成，进度、完成通知和分包资源正常', async () => {
    await runner.open('/');
    await waitText('#load-result', '协议加载：成功');
    await waitText('#progress', '进度：100');
    await waitText('#resource-result', '资源：成功');
    expect(await current().locator('#success-count').innerText()).toBe('成功次数：1');
    expect(await current().locator('#complete-count').innerText()).toBe('完成次数：1');

    await current().locator('#again').click();
    await waitText('#complete-count', '完成次数：2');
    expect(await current().locator('#success-count').innerText()).toBe('成功次数：2');
    await current().locator('#unknown').click();
    await waitText('#unknown-result', '未知包：明确失败且已完成');
  });

  it('基础库原有 require.async 能引用已预注册模块，分包页面可以往返', async () => {
    await runner.open('/');
    await current().locator('#async').click();
    await waitText('#async-result', '模块：异步模块已就绪');
    await current().locator('#detail').click();
    await runner.page.evaluate(() => window.__wxa_test_api__.waitForPage('pkg/detail/index'));
    expect(await current().getByText('分包页面已渲染').isVisible()).toBe(true);
    await current().locator('#back').click();
    await runner.page.evaluate(() => window.__wxa_test_api__.waitForPage('pages/index/index'));
    await waitText('#async-result', '模块：异步模块已就绪');
    expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
  });
});
