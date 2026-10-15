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

// 运行时错误、调用了未实现的原生 API 都不会让测试失败，建议统一检查
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
| `errors()` | 逻辑层、渲染层的运行时错误，以及业务代码调用过的未实现 wx API（`api` 为 API 名称，每个 API 记一次） |

## 注意事项

- 跳转后如果新旧页面有同一个选择器，先用 `waitForPage` 等跳转完成，避免断言落在上一个页面上
- 没有实现的 wx API 仍返回成功，以免打断业务代码，但会在 `errors()` 里记一条；基础库内部调用的原生接口不记。
  用到的请 mock 掉。`onLaunch`、首页 `onLoad` 这类启动阶段就调用的，等 `ready` 后再 mock 已经晚了，要在 [setup](./setup.md) 里 mock
- `wx.request` 不能 mock，要在 setup 里用 `network.routes` 拦截，见 [setup.md](./setup.md#拦截请求)

## 选择图片

`wx.chooseImage`、`wx.chooseMedia` 会打开浏览器的文件选择框，用 Playwright 的 `filechooser` 事件直接给文件，不弹系统窗口。
和真机一样，相册和拍摄都可选（默认）时先弹「拍摄 / 从手机相册选择」菜单，要先点菜单项；只允许相册或拍摄时直接打开文件选择框。

```ts
await current.locator('#avatar').click();
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByRole('button', { name: '从手机相册选择' }).click()
]);
await chooser.setFiles('fixtures/avatar.png');
```

选中的图片存成开发服务器上的临时文件，页面拿到的是 http 地址，可以直接显示和 `uploadFile`。
`chooser.setFiles([])` 等于用户关掉选择框，页面收到 `cancel`。`previewImage` 打开的预览层可以用
`page.getByRole('dialog', { name: '图片预览' })` 找到。

## 类型

第一行的引用为 `window.__wxa_test_api__` 提供类型，也可以写进 tsconfig 的 `compilerOptions.types`。
需要把 `@open-wxa/wxa-runner-core` 加为开发依赖。还没有发布到 npm，可以链接本地仓库：

```bash
pnpm add -D link:<wxa-runner 仓库>/packages/core
```

编写 mock 时用到的 `ApiHandler`、`WxaTestApi` 等类型可以从 `@open-wxa/wxa-runner-core` 导入。
