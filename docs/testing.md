# 在 Playwright 中测试

推荐用 [`@open-wxa/wxa-runner-playwright`](../packages/playwright/README.md) 提供的 fixture：每个 worker 自动启动开发服务器，
用例里直接拿到 `miniProgram`，能读页面 `data`、断言小程序发出的请求。不想多装一个包时，也可以
[直接使用测试 API](#直接使用测试-api)。

## 用 fixture

```bash
pnpm add -D @playwright/test @open-wxa/wxa-runner-playwright
```

```ts
// playwright.config.ts，放在小程序项目目录（project.config.json 所在目录）
import { defineConfig } from '@playwright/test';
import type { WxaOptions } from '@open-wxa/wxa-runner-playwright';

export default defineConfig<WxaOptions>({
  testDir: 'e2e',
  use: {
    channel: 'chrome',   // 使用本机安装的 Chrome
    // wxaProject: './dist/dev/mp-weixin',  // 小程序目录不在配置文件旁边时指定，相对配置文件
  }
});
```

```ts
// e2e/order.spec.ts
import { test, expect } from '@open-wxa/wxa-runner-playwright';

test('提交订单后跳转到结果页', async ({ miniProgram }) => {
  // 打开页面前声明的 mock 和拦截，App.onLaunch 里就生效
  await miniProgram.mock('login', { code: 'test_code' });
  await miniProgram.route('POST **/api/orders', { status: 201, body: { id: 'o-1' } });
  await miniProgram.open('pages/cart/cart');

  // current 始终指向当前页，跳转后不用重新获取
  await miniProgram.current.locator('#submit').click();

  // 会自动重试，跳转后不用手动等待
  await expect(miniProgram).toHavePath('pages/result/result');
  await expect(miniProgram).toHavePageData({ orderId: 'o-1' });

  const request = await miniProgram.waitForRequest('POST **/api/orders');
  expect(request.body).toEqual({ skuId: 1, count: 2 });
});
```

用例结束时 fixture 会检查 `errors()`：小程序有运行时错误、或调用了没有实现的 wx API，用例就失败。
完整示例见 [tests/playwright](../tests/playwright)。

`miniProgram` 的每个成员都有类型注释，在编辑器里悬停就能看到说明。大致分为：

- 打开和跳转：`open`、`current`、`navigateTo` 等，`currentPage`、`pageStack`、`waitForPage`
- 页面：`pageData`、`callPageMethod`
- 原生 API 和请求：`mock`、`route`、`requests`、`waitForRequest`、`clearRequests`
- 其他：`getStorage`、`clearStorage`、`errors`
- 断言：`expect(miniProgram).toHavePath(path)`、`toHavePageData(data, { path? })`，后者只比较列出的字段

同一个用例里再次 `open()` 会整页重新加载：之前的 `mock`、`route` 和撤销（`unmock`、`unroute`，包括撤销 setup 声明的）
都保留，`errors()` 也包含重新加载前出现的错误。`open()` 的页面不在 app.json 里时直接报错。

### mock 和 route 传函数

- 传对象时在浏览器里直接返回；传函数时函数在 Node 里执行，能用用例里的变量、检查小程序传入的参数
- 函数的结果是异步返回的：基础库同步调用的 API 只能 mock 成对象，包括以 `Sync` 结尾的，以及 `getSystemInfo`
  （`wx.getWindowInfo`、`getSystemInfoSync` 等都经过它）、`getMenuButtonBoundingClientRect`；参数和返回值要能序列化
- 撤销或替换之前已经发出的调用，仍由原来的函数处理
- 函数抛错时这次调用失败，用例结束后也失败：写在函数里的 `expect` 失败了不会被吞掉
- `route` 的函数拿到的 `request.body` 已按 Content-Type 解析（JSON、表单），和 `requests()` 一样

### 配置项

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `wxaProject` | `'.'` | 小程序项目目录，相对 Playwright 配置文件所在目录 |
| `wxaServerOptions` | `{}` | 开发服务器的其他参数，如 `baseLibVersion`、`device`、`setup`、`realLogin`；`setup` 等路径也相对配置文件所在目录 |
| `wxaCheckErrors` | `true` | 用例结束时检查 `errors()` 为空。有意触发错误的用例用 `test.use({ wxaCheckErrors: false })` 关掉 |

- 每个 worker 启动一个开发服务器，编译只做一次。`wxaProject`、`wxaServerOptions` 按 worker 生效，
  只能写在配置文件或用例文件顶层的 `test.use` 里（不能在 `describe` 里），修改后 Playwright 会换一个 worker、启动新的开发服务器
- 每个用例一个新的浏览器上下文，Storage、页面栈互不影响

## 直接使用测试 API

不装 fixture 时，用 Playwright 自带的 `webServer` 启动开发服务器，在用例里通过 `window.__wxa_test_api__` 操作。
先装上命令行和类型：

```bash
pnpm add -D @playwright/test wxa-runner @open-wxa/wxa-runner-core
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'npx wxa-runner dev . --no-watch --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI
  },
  use: { baseURL: 'http://localhost:3000', channel: 'chrome' }
});
```

```ts
/// <reference types="@open-wxa/wxa-runner-core/test-api" />
import { test, expect } from '@playwright/test';

test('提交后跳转到结果页', async ({ page }) => {
  await page.goto('/?path=pages/form/form');
  await page.waitForFunction(() => window.__wxa_test_api__);
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

`window.__wxa_test_api__` 提供下面这些成员，详细说明见类型注释（`WxaTestApi`）：

| 成员 | 作用 |
| --- | --- |
| `ready` | 小程序启动完成后 resolve |
| `currentPage()` / `pageStack()` | 当前页 / 整个页面栈，每页含 `path`、`query`、`webviewId`、`frameName`（可用于 `page.frame({ name })`） |
| `waitForPage(path, timeout?)` | 等到指定页面成为当前页，默认超时 10 秒 |
| `pageData(path?)` | 页面的 `data`（拷贝）。不传 `path` 读当前页；页面不在栈里时为 `null` |
| `callPageMethod(name, ...args)` | 调用当前页的方法，返回方法的返回值（返回 Promise 时等它完成）；参数要能 JSON 序列化 |
| `mock(api, impl)` / `unmock(api?)` | 覆盖原生 API：对象作为返回结果，函数按调用参数返回；`unmock()` 不传参数时清除全部 |
| `route(pattern, handler)` / `unroute(pattern?)` | 拦截 `wx.request`，写法同 setup 的 [`network.routes`](./setup.md#拦截请求)，后添加的优先；`unroute()` 不传参数时删除全部 |
| `requests(pattern?)` / `clearRequests()` | 小程序发出的 `wx.request`（方法、地址、请求头、请求体 `data`、命中的拦截规则 `routedBy`），被拦截的和经代理转发的都有，只保留最近 1000 个；可按规则筛选 |
| `navigateTo` / `navigateBack` / `redirectTo` / `reLaunch` / `switchTab` | 直接跳转页面 |
| `getStorage(key)` / `clearStorage()` | 读取、清空小程序的 Storage |
| `errors()` | 逻辑层、渲染层的运行时错误，以及业务代码调用过的未实现 wx API（`api` 为 API 名称，每个 API 记一次） |

## 启动前声明 mock 和拦截

`App.onLaunch`、首页 `onLoad` 里就调用的 API，等 `ready` 之后再 mock 已经晚了。除了写进 [setup](./setup.md)，
也可以在页面脚本执行前定义 `window.__wxa_before_launch__`：宿主在 setup 之后、小程序启动前调用它并等它完成，
这里的 mock 覆盖 setup 的同名 mock。fixture 的「打开页面前 mock」就是这样实现的。

```ts
await page.addInitScript(() => {
  window.__wxa_before_launch__ = api => {
    api.mock('login', { code: 'test_code' });
    api.route('POST **/api/auth/login', { body: { token: 'test-token' } });
  };
});
await page.goto('/');
```

函数可以是 async 的。抛错时模拟器显示错误，小程序不启动。

## 注意事项

- 跳转后如果新旧页面有同一个选择器，先用 `waitForPage`（fixture 里用 `toHavePath`）等跳转完成，避免断言落在上一个页面上
- 没有实现的 wx API 仍返回成功，以免打断业务代码，但会在 `errors()` 里记一条；基础库内部调用的原生接口不记。
  用到的请 mock 掉。`onLaunch`、首页 `onLoad` 这类启动阶段就调用的，等 `ready` 后再 mock 已经晚了，
  要在 [setup](./setup.md) 或 [`__wxa_before_launch__`](#启动前声明-mock-和拦截) 里 mock；用 fixture 时在 `open()` 之前 mock 即可
- `wx.request` 不能 mock，要用 `route` 或 setup 的 `network.routes` 拦截，见 [setup.md](./setup.md#拦截请求)

## 选择图片

`wx.chooseImage`、`wx.chooseMedia` 会打开浏览器的文件选择框，用 Playwright 的 `filechooser` 事件直接给文件，不弹系统窗口。
和真机一样，相册和拍摄都可选（默认）时先弹「拍摄 / 从手机相册选择」菜单，要先点菜单项；只允许相册或拍摄时直接打开文件选择框。

```ts
// 用 fixture 时 current 即 miniProgram.current
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

用 fixture 时不需要额外配置。直接使用测试 API 时，示例第一行的引用为 `window.__wxa_test_api__` 提供类型，
也可以写进 tsconfig 的 `compilerOptions.types`。需要把 `@open-wxa/wxa-runner-core` 加为开发依赖。

编写 mock 时用到的 `ApiHandler`、`WxaTestApi` 等类型可以从 `@open-wxa/wxa-runner-core` 导入。
