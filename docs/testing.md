# 在 Playwright 中测试

先用 `wxa-runner dev <项目> --no-watch` 启动开发服务器，再在用例里打开它。

```ts
/// <reference types="@open-wxa/wxa-runner-core/test-api" />
import { test, expect } from '@playwright/test';

test('提交后跳转到结果页', async ({ page }) => {
  await page.goto('http://localhost:3000/?path=pages/form/form');
  await page.evaluate(() => window.__wxa_test_api__.ready);

  // mock 原生接口
  await page.evaluate(() => window.__wxa_test_api__.mock('login', { code: 'test_code' }));

  // 每个页面是一个 iframe，iframe[data-current] 始终指向当前页，跳转后无需重新获取
  const current = page.frameLocator('iframe[data-current]');
  await current.locator('#submit').click();

  const result = await page.evaluate(() => window.__wxa_test_api__.waitForPage('pages/result/result'));
  expect(result.query).toEqual({ status: 'ok' });
  await expect(current.locator('.result-title')).toHaveText('提交成功');
});

// 逻辑层、渲染层的运行时错误不会让测试失败，建议统一检查
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
});
```

完整示例见 [tests/e2e/showcase.test.ts](../tests/e2e/showcase.test.ts)。

## 测试 API

`window.__wxa_test_api__` 提供：

| 成员 | 作用 |
| --- | --- |
| `ready` | 小程序启动完成后 resolve |
| `currentPage()` / `pageStack()` | 当前页 / 整个页面栈，每页含 `path`、`query`、`webviewId`、`frameName`（可用于 `page.frame({ name })`） |
| `waitForPage(path, timeout?)` | 等到指定页面成为当前页，默认超时 10 秒 |
| `mock(api, impl)` / `unmock(api?)` | 覆盖原生 API：对象作为返回结果，函数按调用参数返回；`unmock()` 不传参数时清除全部 |
| `navigateTo` / `navigateBack` / `redirectTo` / `reLaunch` / `switchTab` | 直接跳转页面 |
| `getStorage(key)` / `clearStorage()` | 读取、清空小程序的 Storage |
| `errors()` | 逻辑层、渲染层收集到的运行时错误 |

## 注意事项

- 跳转后如果新旧页面有同一个选择器，先用 `waitForPage` 等跳转完成，避免断言落在上一个页面上
- 没有实现的原生 API 会返回成功，只在控制台警告一次，`errors()` 里看不到（[#2](https://github.com/open-wxa/wxa-runner/issues/2)）。
  用到的原生 API 请先确认已支持，或者 mock 掉
- `wx.request` 不能 mock，要在 setup 里用 `network.routes` 拦截，见 [setup.md](./setup.md#拦截请求)

## 类型

第一行的引用为 `window.__wxa_test_api__` 提供类型，也可以写进 tsconfig 的 `compilerOptions.types`。
需要把 `@open-wxa/wxa-runner-core` 加为开发依赖。还没有发布到 npm，可以链接本地仓库：

```bash
pnpm add -D link:<wxa-runner 仓库>/packages/core
```

编写 mock 时用到的 `ApiHandler`、`WxaTestApi` 等类型可以从 `@open-wxa/wxa-runner-core` 导入。
