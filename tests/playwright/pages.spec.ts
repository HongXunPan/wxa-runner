/**
 * fixture：打开页面、断言页面状态、调用页面方法，用例结束时检查运行时错误
 */

import { expect, test } from '@open-wxa/wxa-runner-playwright';

test('开发者不用启动开发服务器，打开页面就能操作和断言当前页', async ({ miniProgram }) => {
  await miniProgram.open('pages/index/index');

  await miniProgram.current.locator('#add').click();
  await expect(miniProgram.current.locator('#count')).toHaveText('1');
});

test('开发者断言页面 data，点击跳转后不用手动等待新页面', async ({ miniProgram }) => {
  await miniProgram.open();
  await miniProgram.current.locator('#add').click();
  await expect(miniProgram).toHavePageData({ count: 1 });

  await miniProgram.current.locator('#detail').click();
  await expect(miniProgram).toHavePath('pages/detail/detail');
  await expect(miniProgram).toHavePageData({ id: '42' });
  await expect(miniProgram).not.toHavePageData({ count: 1 });
  await expect(miniProgram).toHavePageData({ count: 1 }, { path: 'pages/index/index' });
});

test('当前页不是期望的页面时，断言超时失败并说明停在哪个页面', async ({ miniProgram }) => {
  await miniProgram.open('pages/index/index');

  await expect(expect(miniProgram).toHavePath('pages/detail/detail', { timeout: 300 })).rejects.toThrow(/pages\/index\/index/);
});

test('开发者打开带参数的页面，读到页面栈和参数', async ({ miniProgram }) => {
  await miniProgram.open('/pages/detail/detail?id=7');

  await expect(miniProgram.current.locator('#id')).toHaveText('7');
  expect(await miniProgram.pageStack()).toEqual([expect.objectContaining({ path: 'pages/detail/detail', query: { id: '7' } })]);
});

test('页面参数里带 ? 时原样传给页面', async ({ miniProgram }) => {
  await miniProgram.open('pages/detail/detail?id=7?from=share');

  await expect(miniProgram.current.locator('#id')).toHaveText('7?from=share');
});

test('打开不存在的页面时报错，不会在首页上继续执行', async ({ miniProgram }) => {
  await expect(miniProgram.open('pages/missing/missing')).rejects.toThrow(/pages\/missing\/missing/);
});

test('开发者调用页面方法，页面更新并拿到返回值', async ({ miniProgram }) => {
  await miniProgram.open();

  expect(await miniProgram.callPageMethod('add', 5)).toBe(5);
  await expect(miniProgram.current.locator('#count')).toHaveText('5');
});

test('小程序还没打开就读取页面时，报错提示先打开', async ({ miniProgram }) => {
  await expect(miniProgram.pageData()).rejects.toThrow(/open\(\)/);
});

// 默认 fullyParallel、两个 worker：两条用例在不同的开发服务器、不同的浏览器上下文里同时运行
for (const run of [1, 2]) {
  test(`每个用例从空的 Storage 开始，打开首页都是第一次访问（${run}）`, async ({ miniProgram }) => {
    await miniProgram.open();

    await expect(miniProgram.current.locator('#visits')).toHaveText('1');
    expect(await miniProgram.getStorage('visits')).toBe(1);
  });
}

test('小程序有未处理的运行时错误时，用例结束后失败', async ({ miniProgram }) => {
  test.fail();
  await miniProgram.open();

  await miniProgram.callPageMethod('crashLater');
  await expect.poll(() => miniProgram.errors()).toHaveLength(1);
});

test('再次打开页面之前出现的运行时错误，用例结束后也让用例失败', async ({ miniProgram }) => {
  test.fail();
  await miniProgram.open();
  await miniProgram.callPageMethod('crashLater');
  await expect.poll(() => miniProgram.errors()).toHaveLength(1);

  await miniProgram.open();
});

test.describe('关闭错误检查', () => {
  test.use({ wxaCheckErrors: false });

  test('有意触发运行时错误的用例关掉错误检查后照常通过', async ({ miniProgram }) => {
    await miniProgram.open();

    await miniProgram.callPageMethod('crashLater');
    await expect.poll(() => miniProgram.errors()).toEqual([expect.objectContaining({ message: '页面里没有处理的错误' })]);
  });

  test('再次打开页面后，errors() 仍包含之前出现的错误', async ({ miniProgram }) => {
    await miniProgram.open();
    await miniProgram.callPageMethod('crashLater');
    await expect.poll(() => miniProgram.errors()).toHaveLength(1);

    await miniProgram.open();
    expect(await miniProgram.errors()).toEqual([expect.objectContaining({ message: '页面里没有处理的错误' })]);
  });
});
