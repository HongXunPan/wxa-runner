# wxa-runner 核心能力缺口分析

> 编写日期：2026-10-15
> 背景：项目目前主要用于两件事——开发时的热更新（HMR），以及 E2E 自动化测试。本文梳理围绕这两个用途还缺哪些核心能力，以及建议的推进顺序。

---

## 一、结论

最该先补的是 **Linux / CI 环境的运行能力**。README 对比表里写着「CI 无头运行 ✓」，但现在只有装了微信开发者工具的 macOS / Windows 机器才跑得起来，Linux CI 跑不了。

其余缺口按影响排序：

| 优先级 | 缺口 | 影响的用途 | 工作量 |
| --- | --- | --- | --- |
| 1 | Linux / CI 运行（编译器、基础库、分发） | E2E | 中（取决于编译器验证结果） |
| 2 | wxss 改动整页刷新，不能热替换 | HMR | 小 |
| 3 | 测试 API 缺少常用断言能力 | E2E | 小到中 |
| 4 | 多实例并行 | E2E | 中 |
| 5 | 基础库停在 3.7.0 | E2E（真实性） | 大，单独立项 |
| — | 插件、分包异步化、Worker | 能跑哪些项目 | 视项目而定 |

---

## 二、Linux / CI：卡在三处，浏览器侧没有问题

wxa-runner 启动时要从本机开发者工具里拿两样东西：

- **编译器 wcc / wcsc**：把 WXML / WXSS 编译成 JS
- **基础库 `.wxvpkg`**：官方的 `WAService.js` / `WAWebview.js`

Linux 上没有开发者工具，两样都拿不到。项目也还没发布到 npm，CI 里安装也不方便。

### 2.1 编译器：有官方现成的线索，值得先验证

微信官方 npm 账号 `wechat-miniprogram` 发布的 [`miniprogram-compiler`](https://www.npmjs.com/package/miniprogram-compiler)（MIT 协议，最新版 0.2.3）里带有 Linux 版的 wcc / wcsc。

已核实的事实（下载 npm 包查看文件，未执行）：

| 项 | `miniprogram-compiler` | 开发者工具（当前使用） |
| --- | --- | --- |
| 发布方 | npm 账号 `wechat-miniprogram` | — |
| Linux 二进制 | `bin/linux/wcc`、`bin/linux/wcsc`，ELF 64-bit x86-64 | 无 |
| 其他平台 | `bin/mac/*`、`bin/windows/*.exe` | `node_modules/wcc-exec/{wcc,wcsc}`（mac 通用二进制） |
| 编译内核版本 | `v0.5vv_20200413_syb_scopedata` | `v0.5vv_20211229_syb_scopedata` |
| 调用方式 | 子进程 + 自定义组件参数 | 相同 |

风险：

- 编译内核比开发者工具旧一年多，新语法或输出格式可能有差异
- 只有 x86-64，ARM 的 Linux 机器不能用

验证方法：在 Linux 容器里用它编译 `examples/showcase`，和 mac 版的输出逐行对比，再跑一遍 E2E。

退路：用 wine 运行 Windows 版的 `wcc.exe` / `wcsc.exe`。

验证结果（2026-10-15）：

- x86-64 Linux 容器里，Linux 版编译 `examples` 下三个项目的输出，与同一 npm 包里 mac 版的输出**逐字节相同**；单元、集成测试全部通过
- 与开发者工具编译器相比，页面的编译结果相同，只有模板运行时差 5 行、样式运行时差 1 行：旧版限制单页最多 16000 个节点；深拷贝用 `o.constructor` 判断类型（无原型的对象会出错）；不支持 `__convertRpxToVw__`
- 用 mac 版旧编译器 + 内置基础库在本机跑完整测试（含 E2E），全部通过
- 容器里的 E2E 没跑通：arm64 mac 上模拟 x86-64 时 Chromium 子进程崩溃（qemu 的已知问题），改由 GitHub Actions（原生 x86-64）验证

已作为没有开发者工具时的默认编译器（`miniprogram-compiler` 是 compiler 包的可选依赖），优先级：`WXA_WCC` / `WXA_WCSC` → 开发者工具 → miniprogram-compiler。

> 顺带：`miniprogram-ci` 里的编译器只有 darwin / win32 的 `.node`，没有 Linux 版，不能用。

### 2.2 基础库：独立仓库 + 可选依赖（已实现）

基础库单独放在 [open-wxa/wxa-baselib](https://github.com/open-wxa/wxa-baselib) 仓库，作为 extractor 包的可选依赖（`github:open-wxa/wxa-baselib`）随 `pnpm install` 安装：

- 只放运行时会加载的 `WAService.js`、`WAWebview.js` 和 `WAVersion.json`（3.7.0 共 6.5MB），不放 30MB 的整个 `.wxvpkg`
- 同一版本优先用开发者工具的；开发者工具没有时用内置的。不指定版本时在两者中选最新的兼容版本，所以默认总是 3.7.0，本地和 CI 一致
- 基础库版权归腾讯，单独成库可以把版权风险和本仓库隔离开；它不可用时只影响没有开发者工具的环境

### 2.3 分发

- 发布到 npm，做到 `npx wxa-runner` 就能用
- 发布官方 Docker 镜像（同时提供 Dockerfile）：预置 Node + Chromium + 编译器 + 常用基础库 + 中文字体，CI 中直接作为 runner 容器运行
  - 字体要固定：截图对比时 Linux 和 mac 的字体渲染不同，会导致基准图对不上

### 2.4 其他依赖开发者工具的地方

- **picker 地区选择器**：行政区划数据（`js/libs/region_sub_strict*`）直接作为静态资源放到 GitHub 或随项目分发，解决 Linux 上缺失的问题
- **真实登录（`--real-login`）不适合 CI**：开发者 ticket 的有效期只有一两个小时（本机实测）。CI 里应继续用 setup 的 `mock` 和 `network.routes`

---

## 三、其余缺口

### 3.1 HMR：wxss 改动不能热替换

现在只有页面、组件自己的 `.wxml` 和 `.js` 能热更新，改 `.wxss` 会整页刷新（见 `packages/core/src/server/hmr.ts` 的 `planHotUpdate`）。

调 UI 时改样式是最频繁的操作。wcsc 本来就给每个页面和组件单独输出一段 `setCssToHead(...)` 样式注入函数，只要重新注入改动的那一段，就能热替换。改动范围小、收益大，是热更新里最划算的一项。

### 3.2 E2E：测试 API 偏薄

`window.__wxa_test_api__` 现在能做的：等页面、读页面栈、mock 原生接口、页面跳转、读 / 清 Storage、收集运行错误。

写断言常用但还没有的：

- 读当前页面的 `data`、调用页面方法
- 在 Node 侧断言请求参数：setup 里的 `network.routes` 在浏览器里执行，Playwright 拿不到请求体
- 会自动重试的断言，如 `toHavePath`、`toHavePageData`

设计文档 Phase 3 里这些是有意暂缓的。等 CI 跑起来、用例变多，很快会成为刚需。

### 3.3 E2E：多实例并行

每个 Playwright worker 都要起一个 DevServer，各自编译一遍。用例多了之后，CI 耗时会成为问题（对应设计文档 Phase 4 的「多实例并行、Docker 部署」）。

### 3.4 真实性：基础库停在 3.7.0

这是长期最大的风险。

- 真机早已运行 3.7 之后很多版本的基础库
- 3.7.1 起基础库结构变了：业务代码跑在原生创建的隔离上下文里（glass-easel 适配）；3.8 起 `WAService.js` 只是占位
- 业务代码用了新 API，或把最低基础库版本设得更高，就测不了

「和真机一致」是这个项目的卖点，这里正是它的短板。工作量大，建议单独立项。

值得调研的一点：开发者工具里 glass-easel 的模板编译器是 WASM 版（`node_modules/glass-easel-template-compiler/glass_easel_template_compiler_bg.wasm`）。如果新版基础库走这条路，编译这一环反而不依赖操作系统。

### 3.5 能跑哪些项目

插件（`plugin://`）、分包异步化、Worker 都不支持，用到它们的项目直接启动不了。要不要做，取决于实际项目用不用。

---

## 四、建议顺序

1. **验证 `miniprogram-compiler` 的 Linux 版能不能用**（半天到一天）。它决定 Linux 支持是小改造还是大工程
2. 基础库托管至 GitHub 并实现 `baselib download`；发布到 npm；提供预构建 Docker 镜像
3. wxss 热更新
4. 补强测试 API
5. 支持 3.7.1 以上的基础库（单独立项）

### 第 1 步的验证计划

- 环境：Docker 里的 x86-64 Linux 容器（arm64 的 mac 上要靠模拟，会慢一些，但够用来验证）
- 步骤：
  1. 安装 `miniprogram-compiler`，用 `WXA_WCC` / `WXA_WCSC` 指向其中的 Linux 二进制
  2. 编译 `examples/showcase`，和 mac 版开发者工具编译器的输出逐行对比
  3. 在容器里跑 `tests/e2e`
- 判定：输出一致且 E2E 全部通过，即可作为 Linux 默认编译器；有差异则评估影响范围，或改走 wine 方案
