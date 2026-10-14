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

- 基础库和编译器从你本机安装的微信开发者工具中读取，**不随本项目分发**
- 逻辑层与渲染层之间的通信、`onAppRoute` 等原生事件，由 wxa-runner 按基础库期望的 `WeixinJSBridge` 接口实现
- 网络请求经开发服务器转发，没有 CORS 限制，可以携带 cookie 等请求头

详细设计见 [PROJECT_DESIGN.md](./PROJECT_DESIGN.md)。

## 快速开始

**前置条件**

- Node.js ≥ 18、pnpm ≥ 8
- 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)并至少打开过一次（用于下载基础库）
- 基础库版本 **≤ 3.7.0**（已验证 2.32.3、3.3.4、3.5.8、3.7.0）。不指定时自动选择本机已下载的最新兼容版本；
  可以在开发者工具「详情 → 本地设置 → 调试基础库」中下载其他版本

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
  --no-watch                不监听文件变化
  -o, --open                启动后打开浏览器

wxa-runner baselib list     列出本机已下载的基础库及兼容性
wxa-runner baselib extract  解包基础库到 ~/.wxa-runner/baselib（dev 会自动执行）
```

`http://localhost:3000/?path=pages/detail/detail&id=1` 可以直接打开指定页面并带上参数。

## 功能

| 能力 | 说明 |
| --- | --- |
| 渲染与逻辑 | WXML、WXSS（rpx）、WXS、自定义组件（含 npm 组件、全局组件、抽象节点），App / Page / Component 生命周期 |
| 路由 | navigateTo / redirectTo / navigateBack / switchTab / reLaunch，10 层页面栈，tabBar 页面实例保留 |
| 界面 | 导航栏（标题、颜色、返回、自定义导航栏）、tabBar、toast / loading / modal / actionSheet |
| 网络 | request / downloadFile / uploadFile 经代理转发，connectSocket 直连 |
| 存储 | Storage 按 appid 隔离存于 localStorage；FileSystemManager 基本操作 |
| 开发体验 | 保存后自动编译并刷新、停留在当前页面；编译错误直接显示在页面上；`import` / `export` 自动转换为 CommonJS（带 source map） |
| 测试 | `window.__wxa_test_api__`：等待页面、读取页面栈、mock 原生 API、读取 Storage、收集运行错误 |

已在真实的 uni-app（Vue 3）编译产物上验证，例如 [unibest](https://github.com/feige996/unibest)。

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
- 文件变化后整页刷新（保留当前页面路径和参数），不保留页面内的数据状态

## 项目结构

```
packages/
  extractor/   @open-wxa/wxa-runner-extractor  定位开发者工具、选择并解包基础库（.wxvpkg）
  compiler/    @open-wxa/wxa-runner-compiler   调用官方 wcc / wcsc 编译 WXML / WXSS
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

欢迎提交 Issue 和 PR。

## 致谢

- 微信团队：官方基础库与编译器
- [WEPT](https://github.com/chemzqm/wept)：最早验证了在浏览器中运行小程序的可行性

## 许可证

[MIT](./LICENSE)。微信基础库与编译器的版权归腾讯所有，本项目不包含也不分发它们，仅在运行时读取用户本机已安装的副本。

---

## English summary

**wxa-runner** runs WeChat Mini Programs in a regular browser using the **official base library** (`WAService.js` / `WAWebview.js`) and the official WXML/WXSS compilers from your local WeChat DevTools installation. It provides only the "native" layer the base library expects — page stack, messaging bridge, `wx.*` native APIs, and native UI such as the navigation bar, tab bar and dialogs.

This lets you debug mini programs with Chrome DevTools and write end-to-end tests with Playwright that run headless in CI, against the real mini-program build output rather than an H5 port. Requires a local WeChat DevTools installation; base library versions up to 3.7.0 are supported.
