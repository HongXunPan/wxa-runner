# wxa-runner

> 在普通浏览器里，用**微信官方基础库**运行小程序。为本地调试和 E2E 自动化测试而生。

[English summary](#english-summary)

```bash
wxa-runner dev ./dist/dev/mp-weixin   # uni-app / Taro 编译产物，或原生小程序目录
# → http://localhost:3000
```

---

## 为什么需要 wxa-runner

开发小程序时，想「看一眼效果」或者「跑一遍自动化测试」，目前只有两条路，都不太理想：

**1. 微信开发者工具**

它是唯一与真机行为一致的环境，但：

- 是一个基于 NW.js 的桌面应用，启动慢、占资源，难以在 CI 和 Linux 服务器上无头运行
- 自动化只能通过 `miniprogram-automator` 远程控制开发者工具，依赖图形界面，速度慢，生态有限
- 用不上 Playwright、Chrome DevTools 这些前端已经很熟悉的工具链

**2. 编译成 H5（uni-app H5、Taro H5 等）**

能在浏览器里跑，但运行的是**另一个平台的产物**：组件、样式隔离、生命周期、API 都由框架重新实现。
H5 上通过的测试，不代表小程序上没有问题。

**wxa-runner 走第三条路**：直接运行小程序的编译产物，并且使用与开发者工具相同的官方基础库和编译器——页面渲染、组件系统、
`setData`、生命周期都是微信自己的代码。wxa-runner 只补上浏览器里缺少的「原生层」：页面栈、消息通道、`wx.*` 原生 API，
以及导航栏、tabBar、弹窗这些原生 UI。

于是你可以：

- 在任何浏览器里调试小程序，用熟悉的 Chrome DevTools 打断点、看网络、看 DOM
- 用 Playwright 写 E2E 测试，在 CI 里无头运行，mock 任意 `wx.*` 接口
- 保存代码后约半秒就在浏览器里看到结果，并停留在当前页面

| | 微信开发者工具 | 编译成 H5 | wxa-runner |
| --- | --- | --- | --- |
| 框架代码 | 官方基础库 | 框架的 H5 实现 | **官方基础库** |
| 业务代码 | 小程序产物 | H5 产物 | **小程序产物** |
| 运行环境 | 桌面应用 | 浏览器 | **浏览器** |
| Playwright / Chrome DevTools | ✗ | ✓ | **✓** |
| CI 无头运行 | 受限 | ✓ | **✓** |

> wxa-runner 不是开发者工具的替代品：预览、上传、真机调试、性能分析仍然需要开发者工具。它是开发和测试阶段的补充。

## 工作原理

```
浏览器
├── 宿主页面            页面栈、路由、wx.* 原生 API、导航栏 / tabBar / 弹窗
├── 逻辑层 iframe       官方 WAService.js + 你的 App / Page / Component 代码
└── 渲染层 iframe × N   官方 WAWebview.js + wcc / wcsc 编译出的模板和样式（每个页面一个）
```

- 基础库和编译器优先从本机开发者工具读取；没有开发者工具时（如 Linux、CI），使用随依赖安装的内置基础库和微信官方 npm 包 [miniprogram-compiler](https://www.npmjs.com/package/miniprogram-compiler) 自带的编译器
- 逻辑层与渲染层之间的通信、`onAppRoute` 等原生事件，由 wxa-runner 按基础库期望的 `WeixinJSBridge` 接口实现
- 网络请求经开发服务器转发，没有 CORS 限制，可以携带 cookie 等请求头

详细设计见 [PROJECT_DESIGN.md](./PROJECT_DESIGN.md)。

## 快速开始

**前置条件**

- Node.js ≥ 18、pnpm ≥ 8
- 基础库版本 **≤ 3.7.0**（已验证 2.32.3、3.3.4、3.5.8、3.7.0）。优先使用本机微信开发者工具下载的版本；开发者工具里没有时（如 Linux、CI），使用随依赖安装的内置基础库 3.7.0（[wxa-baselib](https://github.com/open-wxa/wxa-baselib)）。其他版本可以在开发者工具「详情 → 本地设置 → 调试基础库」中下载

```bash
git clone https://github.com/open-wxa/wxa-runner.git
cd wxa-runner
pnpm install
pnpm build

# 运行仓库自带的示例
node packages/cli/bin/wxa-runner.js dev examples/showcase --open

# 运行你自己的项目
node packages/cli/bin/wxa-runner.js dev /path/to/dist/dev/mp-weixin
```

### 命令

```
wxa-runner dev <project-path>
  -p, --port <port>         端口号（默认 3000）
  --host <host>             监听地址（默认 localhost）
  -b, --baselib <version>   基础库版本
  --setup <file>            启动前执行的 setup 文件（默认使用项目目录下的 wxa.setup.ts / .js / .mjs）
  --no-setup                不执行 setup 文件
  --no-watch                不监听文件变化
  -o, --open                启动后打开浏览器

wxa-runner baselib list     列出可用的基础库（本机已下载的和内置的）及兼容性
wxa-runner baselib extract  解包基础库到 ~/.wxa-runner/baselib（dev 会自动执行；内置基础库无需解包）
```

`http://localhost:3000/?path=pages/detail/detail&id=1` 可以直接打开指定页面并带上参数。

## 功能

| 能力 | 说明 |
| --- | --- |
| 渲染与逻辑 | WXML、WXSS（rpx）、WXS、自定义组件（含 npm 组件、全局组件、抽象节点），App / Page / Component 生命周期 |
| 路由 | navigateTo / redirectTo / navigateBack / switchTab / reLaunch，10 层页面栈，tabBar 页面实例保留 |
| 界面 | 默认模拟 iPhone X；导航栏（标题、颜色、返回、自定义导航栏）、tabBar、toast / loading / modal / actionSheet；样式中的 `env(safe-area-inset-*)` 按页面窗口取值 |
| 网络 | request / downloadFile / uploadFile 经代理转发，connectSocket 直连 |
| 存储 | Storage 按 appid 隔离存于 localStorage；FileSystemManager 基本操作 |
| 启动前准备 | `wxa.setup.ts`：小程序启动前预置存储、覆盖原生 API、拦截请求，跳过登录等浏览器里走不通的环节 |
| 开发体验 | 修改页面或组件的 WXML、页面 JS 后热更新，不刷新、不丢页面状态（见下文）；其他改动自动整页刷新并停留在当前页面；编译错误直接显示在页面上；`import` / `export` 自动转换为 CommonJS（带 source map） |
| 测试 | `window.__wxa_test_api__`：等待页面、读取页面栈、mock 原生 API、读取 Storage、收集运行错误 |

已在真实的 uni-app（Vue 3）编译产物上验证，例如 [unibest](https://github.com/feige996/unibest)。

## 启动前准备（setup）

浏览器里拿不到真实的 `wx.login` code、用户信息、定位等。在项目目录（`project.config.json` 所在目录）
放一个 `wxa.setup.ts`，它会在 `App.onLaunch` 之前执行，让小程序直接进入「已登录」之类的状态：

```ts
// wxa.setup.ts
import { defineSetup } from '@open-wxa/wxa-runner-core/setup';

export default defineSetup(({ env }) => ({
  // 预置存储：值保持原类型，wx.getStorageSync 读到的就是这些值
  storage: {
    token: env.WXA_TOKEN,
    userInfo: { id: 1, nickName: '测试用户' }
  },
  // 覆盖原生 API：对象作为返回结果；函数按调用参数返回，抛错即调用失败
  mock: {
    login: { code: 'dev_code' },
    getLocation: { latitude: 31.23, longitude: 121.47 }
  },
  // 拦截 wx.request：'[请求方法 ]地址'，* 匹配一段路径，** 匹配任意内容（可以不写域名）；
  // 值是响应（body 为对象时按 JSON 返回），也可以是按请求返回响应的函数
  network: {
    routes: {
      'POST **/api/auth/login': { body: { code: 200, data: { token: env.WXA_TOKEN } } },
      'GET **/api/user/*': req => ({ status: 404, body: { msg: `没有 ${req.url}` } })
    }
  },
  // 声明式配置之后执行，适合异步、动态的逻辑
  async run(wxa) {
    const res = await wxa.fetch('https://test-api.example.com/dev/token');  // 经代理，无跨域限制
    wxa.storage.set('token', (await res.json()).token);
  }
}));
```

- **按场景选用**：启动时只检查本地 token 的项目，用 `storage` 预置 token 即可；每次启动都调 `wx.login` 再请求后端
  换 token 的项目，用 `network.routes` 拦截登录接口直接返回 token（或用 `mock.login` 返回测试后端认可的 code）
- **环境变量**：只有 `WXA_` 开头的变量会传给 setup（它在浏览器里执行），如 `WXA_TOKEN=xxx wxa-runner dev .`；
  密钥不要直接写在 setup 文件里
- **执行时机**：每次打开、刷新页面都会重新执行，顺序固定为 storage → mock → network → run；修改 setup 文件后页面自动刷新
- **反馈**：执行结果打印在浏览器控制台（`[wxa-runner] setup 已应用`）；配置写错或执行出错时，模拟器显示错误且不启动小程序
- **类型提示**：不安装任何依赖也能运行；把 `@open-wxa/wxa-runner-core` 加为开发依赖后可获得完整的类型提示和补全
- 存储必须在启动前写入：基础库会把读过的存储缓存在内存里，启动后再从外部改 localStorage，小程序读不到新值
- `wx.request` 不能用 mock 覆盖，请用 `network.routes`；命中的请求会在控制台打印 `[wxa-runner] 拦截请求`。
  拦截的响应默认立即返回，比真机早到；业务代码在回调里假设「首页已经创建」之类时会出错，可以加 `delay`（毫秒）模拟网络耗时。
  `downloadFile`、`uploadFile`、`connectSocket` 暂不拦截

## 热更新

保存文件后不刷新整个模拟器，页面上已有的状态（`data`、页面栈、`globalData`）都保留：

| 改动 | 效果 |
| --- | --- |
| 页面、组件自己的 `.wxml` | 新模板立即生效，用当前 `data` 重新渲染 |
| `Page()` 构造的页面 `.js` | 方法换成新代码，下一次交互就执行新逻辑；已有 `data` 不变，新增的字段补上；`onLoad` 不会重跑；之后新打开的页面完全使用新代码 |
| `Component()` 构造的页面和组件 `.js`（uni-app、Taro 等框架编译出的页面也是） | 只重新挂载这个页面或组件，它自己的状态回到初始值（与 Vite 下修改 Vue 组件 `<script>` 一致）；页面栈、其他页面、`globalData`、Pinia 等全局状态都保留 |
| 其他（`app.js`、`.json`、`.wxss`、`utils` 等普通模块、被引用的模板和 wxs、新增或删除文件） | 整页刷新，恢复整个页面栈（每一页的路径和参数），可以照常一路返回 |

按文件内容判断改动：uni-app 等框架的监听构建每次保存都会重写全部产物，只有内容真正变化的文件才参与判断。

热更新完成后控制台会打印 `[wxa-runner] 热更新完成`；无法热更新时（如新代码执行出错）自动退回整页刷新，同样恢复整个页面栈。
手动刷新浏览器只恢复当前页面。

与 React Fast Refresh 一致，以下情况需要手动刷新才能看到新代码的效果：改了 `onLoad` 等只在打开页面时执行的生命周期；
改了 `data` 的初始值（已有字段以当前状态为准）；更新前已经注册出去的回调（`setTimeout`、`wx.onXxx`）仍是旧函数。

热更新依赖基础库为开发者工具准备的接口，只在监听文件变化时开启；`--no-watch`（如跑测试）时运行环境与真机一致。

## 在 Playwright 中使用

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

跳转后如果新旧页面都有同一个选择器，先用 `waitForPage` 等跳转完成，避免断言落在上一个页面上。

第一行的引用为 `window.__wxa_test_api__` 提供类型（也可以写进 tsconfig 的 `compilerOptions.types`），
需要把 `@open-wxa/wxa-runner-core` 加为开发依赖；目前未发布到 npm，可以链接本地仓库：
`pnpm add -D link:<wxa-runner 仓库>/packages/core`。编写 mock 时用到的 `ApiHandler`、`WxaTestApi` 等类型
可以从 `@open-wxa/wxa-runner-core` 导入。

完整示例见 [tests/e2e/showcase.test.ts](./tests/e2e/showcase.test.ts)。

## 已知限制

- 基础库最高支持 3.7.0。3.7.1 起基础库把业务代码放进原生创建的隔离上下文，尚未模拟
- canvas、video、map 等原生组件，以及相机、蓝牙等设备能力尚未支持
- 插件（`plugin://`）、分包异步化、Worker 尚未支持
- 热更新只覆盖页面和组件的 WXML、JS；其他改动整页刷新（恢复整个页面栈，不保留页面内的数据状态）

## 项目结构

```
packages/
  extractor/   @open-wxa/wxa-runner-extractor  定位开发者工具、选择并解包基础库（.wxvpkg），没有时用内置基础库
  compiler/    @open-wxa/wxa-runner-compiler   调用官方 wcc / wcsc 编译 WXML / WXSS（开发者工具或 miniprogram-compiler 自带）
  core/        @open-wxa/wxa-runner-core       项目构建、开发服务器、浏览器端运行时
  cli/         @open-wxa/wxa-runner-cli        命令行
examples/      showcase（覆盖主要功能）、hello-world、tabbar
tests/         unit / integration / e2e
```

## 参与开发

```bash
pnpm build
pnpm test            # 单元 + 集成 + e2e；缺少开发者工具或 Chrome 时相关用例自动跳过
pnpm test:coverage
```

e2e 默认使用 `/Applications/Google Chrome.app`，其他位置通过环境变量 `WXA_CHROME` 指定。
开发者工具不在默认位置时，可用 `WXA_DEVTOOLS_PATH`、`WXA_VENDOR_DIR`（基础库目录）、`WXA_WCC` / `WXA_WCSC` 指定。

**Linux / CI**：不需要开发者工具，`pnpm install` 会装上内置基础库和 miniprogram-compiler，只需指定 Chrome，如 `WXA_CHROME=/usr/bin/google-chrome pnpm test`，参考 [.github/workflows/ci.yml](./.github/workflows/ci.yml)。和开发者工具相比有三点差异：

- miniprogram-compiler 只有 x86-64 的 Linux 版，ARM 的 Linux 机器不能用
- 它的编译内核较旧（20200413，开发者工具为 20211229）：页面的编译结果相同，只有模板运行时有少量差异，如旧版限制单页最多 16000 个节点
- 地区选择器（`picker mode="region"`）的行政区划数据取自开发者工具，Linux 上不可用

欢迎提交 Issue 和 PR。

## 致谢

- 微信团队：官方基础库与编译器
- [WEPT](https://github.com/chemzqm/wept)：最早验证了在浏览器中运行小程序的可行性

## 许可证

[MIT](./LICENSE)。

---

## English summary

**wxa-runner** runs WeChat Mini Programs in a regular browser using the **official base library** (`WAService.js` / `WAWebview.js`) and the official WXML/WXSS compilers. It provides only the "native" layer the base library expects — page stack, messaging bridge, `wx.*` native APIs, and native UI such as the navigation bar, tab bar and dialogs.

This lets you debug mini programs with Chrome DevTools and write end-to-end tests with Playwright that run headless in CI, against the real mini-program build output rather than an H5 port. Base library versions up to 3.7.0 are supported.
