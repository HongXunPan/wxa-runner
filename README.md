# wxa-runner

> 在普通浏览器里，用**微信官方基础库**运行小程序。为本地调试和 E2E 自动化测试而生。

[English](./README.en.md) · 中文

```bash
npx wxa-runner dev ./dist/dev/mp-weixin   # 原生小程序目录，或 uni-app / Taro 编译产物
# → http://localhost:3000
```

目前只支持基础库 3.7.0 及以下。其他限制见[已知限制](#已知限制)。

## 为什么用 wxa-runner

- **和真机一致**：直接运行小程序的编译产物，渲染、组件、`setData`、生命周期都是微信官方基础库的代码，不是 H5 那样由框架重新实现
- **无头 E2E**：用 Playwright 直接在浏览器里测试，不用远程控制开发者工具；CI 里无头运行，Linux 上不需要开发者工具
- **热更新不丢状态**：改 WXML、WXSS、JS 后原地更新，不刷新页面，页面栈和全局状态都保留，不用一路点回当前页
- **用熟悉的工具调试**：Chrome DevTools 打断点、看网络请求、看 DOM
- **跳过走不通的环节**：在 setup 里预置登录态、mock 原生 API、拦截请求，不用改业务代码
- **直接打开任意页面**：地址加上 `?path=pages/detail/detail&id=1`，开发和测试都能直接定位到页面

它不替代开发者工具：预览、上传、真机调试仍然要用开发者工具。

## 快速开始

需要 Node.js ≥ 18。在小程序目录（`project.config.json` 所在目录，或 uni-app / Taro 编译出的 `mp-weixin` 目录）里运行：

```bash
npx wxa-runner dev . --open
```

```
[wxa-runner] 编译完成：3 个页面，1 个组件，17ms

  wxa-runner 已启动
  地址      http://localhost:3000
  项目      /path/to/my-app
  基础库    3.7.0
```

经常用或要在 CI 里跑，装成开发依赖：`pnpm add -D wxa-runner`（或 `npm i -D wxa-runner`）。

基础库和编译器不用另外准备：本机有微信开发者工具就用它的，没有就用随依赖安装的内置版本。
内置基础库从 GitHub 安装（[wxa-baselib](https://github.com/open-wxa/wxa-baselib)），需要本机有 git、能访问 github.com；
访问不了时安装不会报错，只是没有内置基础库，在没有开发者工具的机器上启动会提示找不到基础库。
命令选项和环境变量见 [docs/cli.md](./docs/cli.md)。

## 用法

### 跳过登录

在 `project.config.json` 所在目录放一个 `wxa.setup.ts`，它在小程序启动前执行：

```ts
import { defineSetup } from '@open-wxa/wxa-runner-core/setup';

export default defineSetup(({ env }) => ({
  storage: { token: env.WXA_TOKEN },                              // 预置存储
  mock: { getLocation: { latitude: 31.23, longitude: 121.47 } },  // 覆盖原生 API
  network: {                                                      // 拦截 wx.request
    routes: { 'POST **/api/auth/login': { body: { token: env.WXA_TOKEN } } }
  }
}));
```

需要真实的登录 code 或手机号时，启动加 `--real-login`。详见 [docs/setup.md](./docs/setup.md)。

### 热更新

| 改动 | 效果 |
| --- | --- |
| 页面、组件自己的 `.wxml` 和 `.js`，所有 `.wxss` | 热更新，不刷新页面，页面栈和全局状态保留 |
| 其他（`app.js`、`.json` 等） | 整页刷新，恢复整个页面栈 |

详见 [docs/hot-reload.md](./docs/hot-reload.md)。

### 在 Playwright 中测试

装上 `@open-wxa/wxa-runner-playwright`，每个 worker 自动启动开发服务器：

```ts
import { test, expect } from '@open-wxa/wxa-runner-playwright';

test('提交后跳转到结果页', async ({ miniProgram }) => {
  await miniProgram.mock('login', { code: 'test_code' });  // 打开前声明，App.onLaunch 里就生效
  await miniProgram.open('pages/form/form');

  await miniProgram.current.locator('#submit').click();     // current 始终指向当前页

  await expect(miniProgram).toHavePath('pages/result/result');
  await expect(miniProgram).toHavePageData({ status: 'ok' });
  expect((await miniProgram.waitForRequest('POST **/api/form')).body).toEqual({ name: '张三' });
});
```

配置、`mock` 与请求拦截、不用 fixture 的接法见 [docs/testing.md](./docs/testing.md)。

## 功能

| 能力 | 支持 |
| --- | --- |
| 渲染 | WXML、WXSS、WXS、自定义组件，App / Page / Component 生命周期 |
| 路由 | navigateTo、redirectTo 等页面路由，10 层页面栈，tabBar |
| 界面 | 导航栏、tabBar、toast / modal / actionSheet，默认模拟 iPhone X |
| 组件 | picker、canvas、camera、web-view |
| 媒体 | chooseImage、chooseMedia（只能选图片）由浏览器选文件，previewImage、getImageInfo，保存到相册即下载 |
| 网络 | request、上传下载经代理转发（没有 CORS 限制），WebSocket |
| 存储 | Storage、FileSystemManager 基本操作 |

已在 uni-app（Vue 3）的真实项目上验证；基础库已验证 2.32.3、3.3.4、3.5.8、3.7.0。

## 已知限制

- 基础库最高 3.7.0（[#9](https://github.com/open-wxa/wxa-runner/issues/9)）
- 没有实现的原生 API 会返回成功，测试中可以从 `errors()` 发现（见 [docs/testing.md](./docs/testing.md#注意事项)）
- 不支持 video、map、音频、蓝牙（[#8](https://github.com/open-wxa/wxa-runner/issues/8)），`chooseMedia` 不能选视频
- 不支持插件、分包异步化、Worker（[#10](https://github.com/open-wxa/wxa-runner/issues/10)）
- 没有开发者工具时（如 Linux、CI）：只支持 x86-64；编译器版本较旧，模板运行时有少量差异（如单页最多 16000 个节点）；地区选择器不可用

## 参与开发

从源码构建、运行示例和测试见 [CONTRIBUTING.md](./CONTRIBUTING.md)。欢迎提交 Issue 和 PR。

## 致谢

- 微信团队：官方基础库与编译器
- [WEPT](https://github.com/chemzqm/wept)：最早验证了在浏览器中运行小程序的可行性

## 许可证

[MIT](./LICENSE)。内置基础库 [wxa-baselib](https://github.com/open-wxa/wxa-baselib) 是微信官方代码，版权归腾讯所有，不适用本项目的 MIT 协议。
