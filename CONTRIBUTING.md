# 参与开发

使用方式见 [README](./README.md)（[English](./README.en.md)）。这里是在本仓库里开发 wxa-runner 需要知道的内容。

## 目录结构

```
packages/
  extractor/   @open-wxa/wxa-runner-extractor  定位开发者工具、选择并解包基础库（.wxvpkg），没有时用内置基础库
  compiler/    @open-wxa/wxa-runner-compiler   调用官方 wcc / wcsc 编译 WXML / WXSS（开发者工具或 miniprogram-compiler 自带）
  core/        @open-wxa/wxa-runner-core       项目构建、开发服务器、浏览器端运行时
  cli/         wxa-runner                      命令行（包名不带 scope，npx wxa-runner 直接可用）
  playwright/  @open-wxa/wxa-runner-playwright Playwright fixture
examples/      showcase（覆盖主要功能）、hello-world、tabbar
tests/         unit / integration / e2e，playwright（用 fixture 写的用例）
```

## 构建与测试

```bash
pnpm install
pnpm build
pnpm test            # 单元 + 集成 + e2e
pnpm test:playwright # tests/playwright，用 Playwright 的 test runner 跑，需要先 pnpm build
pnpm test:coverage

node packages/cli/bin/wxa-runner.js dev examples/showcase --open   # 用源码运行示例
```

- 找不到编译器、基础库或 Chrome 时，依赖它们的用例会自动跳过；`pnpm test:playwright` 不跳过，找不到时直接报错
- e2e 默认使用 `/Applications/Google Chrome.app`，其他位置通过环境变量 `WXA_CHROME` 指定，如 Linux 上
  `WXA_CHROME=/usr/bin/google-chrome pnpm test`
- 本机没有开发者工具时，`pnpm install` 装上的内置基础库和 miniprogram-compiler 就够跑全部测试

## CI

[.github/workflows/ci.yml](./.github/workflows/ci.yml) 在 ubuntu-latest 上跑全部测试（`pnpm test` 和 `pnpm test:playwright`），
测试前先确认编译器、基础库和 Chrome 都找得到：缺少时依赖它们的用例会自动跳过，CI 却显示通过。
最后用 `node scripts/release.mjs --dry-run` 打包全部 npm 包，像外部用户一样在新目录里用 npm 安装，确认
`wxa-runner dev` 能启动示例项目、用上内置基础库和 miniprogram-compiler。

## 发布

5 个包版本号保持一致，推送 `v*` tag 时由 [.github/workflows/release.yml](./.github/workflows/release.yml) 发布到 npm：

```bash
pnpm -r --include-workspace-root exec npm pkg set version=0.2.0   # 改全部 package.json 的版本号
git commit -am "chore: 0.2.0" && git push
git tag v0.2.0 && git push origin v0.2.0
```

- release.yml 先跑一遍 CI，再执行 `node scripts/release.mjs`：打包、在新目录里安装试跑、按依赖顺序发布。
  tag 与版本号不一致时直接失败；npm 上已有的版本会跳过，中途失败后重跑这个 workflow 即可
- 认证用 npm 的 Trusted Publishing，不需要 token：每个包在 npmjs.com 的设置里登记了本仓库的 `release.yml`
- 版本号带 `-`（如 `0.2.0-beta.1`）时发布到 `next` 标签，`npm i wxa-runner` 装到的版本不变
- 新增包时，把目录加到 `scripts/release.mjs` 的 `PACKAGE_DIRS`（被依赖的排在前面），package.json 照着已有的包写上
  `repository`、`publishConfig` 等字段。Trusted Publishing 只能给 npm 上已有的包配置，所以新包的第一个版本要在本机
  `npm login` 后执行 `node scripts/release.mjs` 手动发布，再到 npmjs.com 为它登记 `release.yml`。登记后 2 天内要由
  release.yml 成功发布一次，否则登记失效

## 工作原理

```
浏览器
├── 宿主页面            页面栈、路由、wx.* 原生 API、导航栏 / tabBar / 弹窗
├── 逻辑层 iframe       官方 WAService.js + 小程序的 App / Page / Component 代码
└── 渲染层 iframe × N   官方 WAWebview.js + wcc / wcsc 编译出的模板和样式（每个页面一个）
```

逻辑层与渲染层之间的通信、`onAppRoute` 等原生事件，由 wxa-runner 按基础库期望的 `WeixinJSBridge` 接口实现。
详细设计见 [PROJECT_DESIGN.md](./PROJECT_DESIGN.md)。
