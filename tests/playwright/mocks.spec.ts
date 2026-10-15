/**
 * fixture：mock 原生 API，对象在浏览器里返回，函数在 Node 里执行
 */

import { expect, test } from '@open-wxa/wxa-runner-playwright';

test('开发者在打开页面前 mock，App.onLaunch 里的调用就拿到 mock 结果', async ({ miniProgram }) => {
  await miniProgram.mock('login', { code: 'from-test' });
  await miniProgram.open();

  await expect(miniProgram.current.locator('#code')).toHaveText('from-test');
});

test('开发者在打开页面前用 Node 里的函数 mock，启动时就由它返回结果', async ({ miniProgram }) => {
  let calls = 0;
  await miniProgram.mock('login', () => ({ code: `node-${++calls}` }));
  await miniProgram.open();

  await expect(miniProgram.current.locator('#code')).toHaveText('node-1');
});

test('开发者用 Node 里的函数 mock，检查小程序传入的参数', async ({ miniProgram }) => {
  const calls: unknown[] = [];
  await miniProgram.open();
  await miniProgram.mock('getLocation', args => {
    calls.push(args);
    return { latitude: 31.2, longitude: 121.5 };
  });

  await miniProgram.current.locator('#locate').click();
  await expect(miniProgram.current.locator('#location')).toHaveText('31.2,121.5');
  expect(calls).toEqual([expect.objectContaining({ type: 'gcj02' })]);
});

test('整页重新加载后，之前声明的 mock 仍然生效', async ({ miniProgram }) => {
  await miniProgram.open();
  await miniProgram.mock('login', { code: 'kept' });

  await miniProgram.open();
  await expect(miniProgram.current.locator('#code')).toHaveText('kept');
});

test('撤销 mock 后恢复内置实现', async ({ miniProgram }) => {
  await miniProgram.mock('login', { code: 'from-test' });
  await miniProgram.unmock('login');
  await miniProgram.open();

  await expect(miniProgram.current.locator('#code')).not.toHaveText('from-test');
  await expect(miniProgram.current.locator('#code')).not.toHaveText('');
});

test('同步 API 只能 mock 成固定结果，传函数时立即报错', async ({ miniProgram }) => {
  await expect(miniProgram.mock('getSystemInfoSync', () => ({}))).rejects.toThrow(/同步/);
});

test('mock 函数抛错时，小程序收到失败，用例结束后失败', async ({ miniProgram }) => {
  test.fail();
  await miniProgram.open();
  await miniProgram.mock('getLocation', () => {
    throw new Error('定位参数不对');
  });

  await miniProgram.current.locator('#locate').click();
  await expect(miniProgram.current.locator('#location')).toContainText('getLocation:fail');
});
