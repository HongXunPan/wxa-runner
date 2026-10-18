# wxa-runner 项目设计文档

> **设计理念**：站在微信官方与 WEPT 的肩膀上，构建一个现代化、极速、真实的小程序浏览器运行时。

本文档描述的是**当前代码的实际设计**。和最初方案不同的地方，在对应章节中以「与最初方案的差异」注明。

---

## 📐 设计哲学

### 1. 真实性优先（Authenticity First）

**理念**：不重新发明轮子，最大化复用微信官方实现。

- ✅ **使用官方基础库**：运行时直接加载微信开发者工具下载的 `WAService.js` / `WAWebview.js`，App/Page/Component、exparser 组件系统、setData 与渲染全部由官方代码完成
- ✅ **使用官方编译器**：调用开发者工具自带的 `wcc` / `wcsc`，编译结果与开发者工具一致
- ✅ **使用官方协议**：宿主实现的是基础库期望的原生接口 `WeixinJSBridge`（`invoke` / `publish` / `subscribe` / `on`），以及 `onAppRoute` 等原生事件

**我们的角色**：「原生层」而不是「框架层」。wxa-runner 只实现微信客户端原生部分在浏览器里的替代品：
消息桥、页面栈、原生 API、导航栏/tabBar/弹窗等原生 UI。

**官方代码从哪里来**：基础库和编译器都从用户本机的微信开发者工具中读取，不随本项目分发
（版权归腾讯）。见 [基础库与编译器的获取](#1-基础库与编译器的获取)。

### 2. 极速体验（Speed Obsession）

- ✅ **内存编译**：编译器输出直接读自子进程 stdout，不写临时文件（仅超长参数时写一个参数文件）
- ✅ **并行编译**：渲染层 wxml、逻辑层 wxml、wxss 三次编译并行执行
- ✅ **按类型增量**：只改了 JS 时不重新编译模板和样式；只改了 wxss 时不重新编译 wxml
- ✅ **共享构建**：并发请求共享同一次构建，结果缓存到下次文件变化

**实测**（showcase 示例，M 系列 Mac）：完整编译 70ms 左右，单文件修改后重新编译 7–25ms，
文件保存到浏览器刷新完成约 450ms。

> 与最初方案的差异：没有使用 Worker 线程池和 HTTP/2 Server Push。编译器以子进程运行，
> 原因见 [编译器](#2-编译器wxa-runner-compiler)；本地开发场景下 HTTP/1.1 已经足够快。

### 3. 开发友好（Developer Experience）

- ✅ **零配置启动**：`wxa-runner dev ./dist/dev/mp-weixin`
- ✅ **自动刷新**：chokidar 监听文件 → 增量编译 → WebSocket 通知浏览器刷新，**刷新后停留在当前页面和参数**
- ✅ **编译错误可读**：直接显示官方编译器给出的文件和行列号，修复后自动恢复
- ✅ **Chrome DevTools 调试**：每个 JS 文件单独一个 `<script>`，行号与源文件一致；ES Module 语法经 esbuild 转换后附带 source map；
  基础库脚本通过 source map 加入 DevTools 的忽略列表，控制台的来源链接、调用栈和单步调试都落在业务代码上
- ✅ **深链接**：`http://localhost:3000/?path=pages/detail/detail&id=1` 直接打开指定页面
- ⏳ VSCode 插件：未开始

> 与最初方案的差异：「热更新」实现为整页刷新 + 恢复当前路由，不保留页面内存状态。

### 4. 测试至上（Test-Driven）

- ✅ **Playwright 可直接操作**：每个页面是一个同源 iframe，元素可以用标准选择器查询
- ✅ **无头模式**：已在 headless Chrome 下验证
- ✅ **Mock 注入点**：`window.__wxa_test_api__.mock(api, impl)` 覆盖任意原生 API
- ✅ **Playwright fixture**：`@open-wxa/wxa-runner-playwright` 每个 worker 启动开发服务器，读页面 data、断言请求、自动重试的断言

### 5. 架构分层（Layered Architecture）

```
┌──────────────────────────────────────────────────────────┐
│ 应用层   cli                   命令行                      │
│          playwright            Playwright fixture          │
└───────────────┬──────────────────────────────────────────┘
┌───────────────┴──────────────────────────────────────────┐
│ 服务层   core/server  DevServer、网络代理、WS               │
└──┬──────────────────────┬────────────────────────────────┘
┌──┴──────────────┐ ┌─────┴──────────────────────────────────┐
│ 构建层           │ │ 浏览器运行时 core/runtime                │
│ core/project    │ │  host：页面栈、路由、原生 API、手机外壳 UI │
│ compiler        │ │  frame：注入 iframe 的 WeixinJSBridge     │
│ extractor       │ │  ── 官方 WAService.js / WAWebview.js ──   │
└─────────────────┘ └────────────────────────────────────────┘
```

> 与最初方案的差异：没有引入依赖注入框架，模块之间通过构造参数传递依赖。

---

## 🏗️ 项目结构

```
wxa-runner/
├── packages/
│   ├── extractor/                     # @open-wxa/wxa-runner-extractor：基础库定位与解包
│   │   └── src/
│   │       ├── wxvpkg.ts              # .wxvpkg 格式解析
│   │       ├── devtools.ts            # 定位开发者工具安装目录 / 用户数据目录
│   │       └── baselib.ts             # 版本列表、兼容性判断、解包到 ~/.wxa-runner/baselib
│   │
│   ├── compiler/                      # @open-wxa/wxa-runner-compiler：官方编译器封装
│   │   └── src/
│   │       ├── locate.ts              # 定位 wcc / wcsc 可执行文件
│   │       ├── wcc.ts                 # WXML/WXS → $gwx（渲染层完整版 / 逻辑层裁剪版）
│   │       ├── wcsc.ts                # WXSS → setCssToHead 代码，解析 key=value 输出
│   │       └── exec.ts
│   │
│   ├── core/                          # @open-wxa/wxa-runner-core
│   │   └── src/
│   │       ├── project/
│   │       │   ├── MiniProgram.ts     # 读取 app.json / 页面与组件 json、收集组件、列文件
│   │       │   ├── AppBuilder.ts      # 生成逻辑层 / 渲染层产物，按类型增量
│   │       │   └── wxConfig.ts        # 生成 __wxConfig
│   │       ├── server/
│   │       │   ├── DevServer.ts       # HTTP 路由、WebSocket、文件变化后重新编译并通知浏览器
│   │       │   ├── watcher.ts         # 文件监听：合并一次保存的改动，内容没变的不算
│   │       │   ├── hmr.ts             # 改动能否热更新
│   │       │   ├── html.ts            # 宿主 / 逻辑层 / 渲染层 HTML
│   │       │   ├── proxy.ts           # wx.request 等的转发代理
│   │       │   ├── realLogin.ts       # --real-login 的真实登录接口
│   │       │   ├── developerTicket.ts # 真实登录的 ticket：新版开发者工具经自动化接口实时获取
│   │       │   └── setup.ts           # 编译 setup 文件
│   │       └── runtime/               # 浏览器端（打包为 dist/runtime/host.js、frame.js）
│   │           ├── frame.ts           # 注入 iframe：全局变量、WeixinJSBridge、设备尺寸、触摸模拟
│   │           ├── context.ts         # 新版基础库：模拟原生 WeixinJSContext，在逻辑层里创建子上下文
│   │           └── host/
│   │               ├── Host.ts        # 宿主：消息分发、路由、页面栈
│   │               ├── PageStack.ts   # 页面栈（纯逻辑）
│   │               ├── PageView.ts    # 单个渲染层 iframe
│   │               ├── testApi.ts     # window.__wxa_test_api__（每个成员的说明写在 WxaTestApi 的注释里）
│   │               ├── api/           # 原生 API：storage / system / network / ui / media / picker / webView / misc + 注册表
│   │               └── ui/            # 手机外壳：状态栏、导航栏、tabBar、toast、modal、actionSheet、选择器、图片预览、文件选择框
│   │
│   ├── cli/bin/wxa-runner.js          # wxa-runner：命令行（npm 包名不带 scope，npx wxa-runner 直接可用）
│   │
│   └── playwright/                    # @open-wxa/wxa-runner-playwright：Playwright fixture
│       └── src/
│           ├── index.ts               # test / expect、配置项；每个 worker 一个 DevServer
│           ├── miniProgram.ts         # miniProgram：转发测试 API；mock / route 等按调用顺序记在 Node 侧，页面加载时重放
│           ├── matchers.ts            # toHavePath / toHavePageData
│           ├── request.ts             # 按 Content-Type 解析请求体
│           └── server.ts              # 开发服务器参数，路径相对 Playwright 配置文件
│
├── examples/
│   ├── showcase/                      # 覆盖主要功能的示例（组件、wxs、路由、tabBar、API）
│   ├── hello-world/
│   └── tabbar/
│
└── tests/
    ├── unit/                          # 解包、编译、项目解析、构建、文件监听、运行时纯逻辑、原生 API
    ├── integration/                   # DevServer 路由、网络代理
    ├── e2e/                           # 真实浏览器运行 showcase 和临时小程序（原生组件等）
    └── playwright/                    # 用 Playwright fixture 写的用例（pnpm test:playwright）
```

> 与最初方案的差异：`vendor/` 目录不再存在，基础库在运行时从开发者工具解包到用户目录。

---

## 🧩 核心模块设计

### 1. 基础库与编译器的获取

| 资源 | 位置（macOS） | 说明 |
| --- | --- | --- |
| 基础库 | `~/Library/Application Support/微信开发者工具/<id>/WeappVendor/<版本>.wxvpkg` | 开发者工具按需下载的各版本基础库 |
| 编译器 | `/Applications/wechatwebdevtools.app/Contents/Resources/<程序目录>/node_modules/wcc-exec/{wcc,wcsc}` | 命令行版本，x86_64 + arm64 通用二进制 |
| 行政区划数据 | `<程序目录>/js/libs/region_sub_strict*`，新版在 `app.asar` 里 | 地区选择器用，见「原生组件」 |

程序目录：旧版开发者工具是 `package.nw`；新版（2.02 起，Electron）把大部分文件打包在 `app.asar`，编译器等要直接执行的文件解包在
`app.asar.unpacked`。两种都支持，行政区划数据直接从 `app.asar` 里读出（读法见 `wxa-runner-extractor` 的 `asar.ts`）。

`.wxvpkg` 是一个简单的打包格式：`0xBE` 魔数 + 文件索引（名称、偏移、长度，大端序）+ 文件内容。
`wxa-runner-extractor` 解析它，把选定的版本解包到 `~/.wxa-runner/baselib/<版本>/` 并缓存。
以上位置均可通过环境变量覆盖：`WXA_DEVTOOLS_PATH`、`WXA_VENDOR_DIR`、`WXA_WCC` / `WXA_WCSC`。

**默认使用的基础库版本：≤ 3.7.0**（`MAX_COMPATIBLE_VERSION`，已验证的范围）。不指定版本时，自动选择本机已安装的最新兼容版本；
更高的版本用 `--baselib` 或 `WXA_BASELIB` 指定，启动时提示超出已验证的范围。

| 版本 | 逻辑层结构 | 状态 |
| --- | --- | --- |
| 2.x – 3.7.0 | `WAService.js` 包含完整框架，在单个 JS 上下文中运行 | ✅ 已验证 2.32.3 / 3.3.4 / 3.5.8 / 3.7.0 |
| 3.7.1 起 | 业务代码运行在由原生 `WeixinJSContext` 创建的隔离上下文中（glass-easel 适配） | 🧪 全部测试在 3.7.1 / 3.8.8 上通过，需显式指定版本 |
| 3.8 起 | `WAService.js` 只是占位，框架在 `WAServiceMainContext.js` / `WASubContext.js` | 同上 |

3.7.1 起（`ISOLATED_CONTEXT_SINCE`），逻辑层 iframe 加载 `WAServiceMainContext.js`，作为主上下文；
`runtime/context.ts` 在其中提供 `WeixinJSContext`，主上下文用它创建子上下文（逻辑层里的同源 iframe，加载 `WASubContext.js`），
业务代码在名为 `app` 的子上下文里执行。主、子上下文之间的消息由基础库直接互相调用，不经过 wxa-runner。
业务代码的启动要经过几步基础库内部行为，任何一步没发生时，超时后报告停在哪一步，小程序照常结束启动。
原生接口的约定由模拟基础库（`tests/fakeBaseLib.ts`）固定，CI 上没有新版基础库也能测到。

### 2. 编译器（wxa-runner-compiler）

**为什么用子进程而不是 `wcc.node` 原生模块**：原生模块在同一 Node 进程中重复调用会随机触发
`std::bad_alloc` 崩溃（与调用顺序、GC 无关，可稳定复现）。命令行版本与原生模块是同一个编译内核
（`v0.5vv_20211229_syb_scopedata`），单次编译约 6ms，子进程天然隔离。

**WXML（wcc）**：项目中所有 `.wxml` 和 `.wxs` 一次编译成一个 `$gwx` 函数，`import` / `include` /
wxs 引用由编译器自己解析。需要告诉编译器每个页面/组件中哪些标签是自定义组件（`-cc` / `-xc` 参数），
格式与开发者工具一致：

```
[页面数, "./pages/a/a.wxml", 2, "comp-a", "comp-b", "./components/x/x.wxml", 0, ...]  // 以分隔符连接
```

同一份 wxml 编译两次：
- **渲染层**使用完整版（`-cc`）
- **逻辑层**使用裁剪版（`-xc`）。exparser 在逻辑层也要知道组件的节点结构，缺少它会导致
  「expect FLOW_CREATE_NODE but get another」

**WXSS（wcsc）**：输出是 `key=value=key=value…` 交替的字符串，值为转义过的 JS 源码：
- `comm`：公共运行时（`setCssToHead`、rpx 换算）以及 `app.wxss` 的立即执行代码
- `./pages/a/a.wxss`：每个页面/组件一个 `setCssToHead(...)`，返回的函数在页面创建时调用

rpx 换算由 wcsc 生成的运行时完成，不需要我们处理（最初实现中服务端的正则替换已删除）。

### 3. 项目构建（core/project）

**json 预处理**（与开发者工具相同）：
- `app.json` 的全局 `usingComponents` 展开到每个页面和组件（`miniprogram_npm` 和独立分包除外）
- 每个页面/组件 json 都保证有 `usingComponents` 字段

**组件收集**：从所有页面（含分包）出发，递归解析 `usingComponents` 和 `componentGenerics` 默认实现。
引用解析顺序：`/` 开头为根路径；否则先按相对路径，再沿目录向上查找 `miniprogram_npm`。

**`__wxConfig`**：字段与开发者工具一致（`pages`、`page["x.html"].window`、`global.window` 默认值、
`entryPagePath`、tabBar 的 `pagePath` 带 `.html` 后缀、`accountInfo`、`appLaunchInfo` 等）。

**逻辑层产物**：

```js
// 每个 JS 文件单独一个脚本：/__wxa__/module/pages/a/a.js
define("pages/a/a.js", function(require, module, exports, window, document, ...){<原文件内容>
});

// /__wxa__/service-bootstrap.js
<裁剪版 $gwx>
__wxAppCode__["app.json"] = {...};
__wxAppCode__["pages/a/a.json"] = {...};               // 每个组件和页面
__wxAppCode__["pages/a/a.wxml"] = $gwx("./pages/a/a.wxml");
require("app.js");
__wxRoute = "components/x/x"; __wxRouteBegin = true; require("components/x/x.js");   // 先组件
__wxRoute = "pages/a/a";      __wxRouteBegin = true; require("pages/a/a.js");        // 再页面
```

- 包装头和代码第一行在同一行，报错行号与源文件一致
- 使用 `import` / `export` 的文件先用 esbuild 转为 CommonJS（对应开发者工具的「ES6 转 ES5」），内联 source map
- 单个模块执行出错只影响它自己，其余页面照常注册

**渲染层产物**（`/__wxa__/page-frame.js`，所有页面共用）：完整版 `$gwx` + wcsc `comm` + 每个页面/组件的
`__wxAppCode__` json / wxml / wxss。每个页面的 HTML 再执行：

```js
__wxAppCode__["pages/a/a.wxss"]();
document.dispatchEvent(new CustomEvent("generateFuncReady", {
  detail: { generateFunc: $gwx("./pages/a/a.wxml") }
}));
```

### 4. 浏览器运行时（core/runtime）

#### iframe 布局

```
宿主页面 /                         host.js：Host、页面栈、原生 API、手机外壳 UI
├── iframe /__wxa__/appservice.html          逻辑层（隐藏）
│     frame.js → WAService.js → 业务模块 → service-bootstrap.js
├── iframe /__wxa__/webview/pages/a/a.html?id=1   渲染层（每个页面一个）
│     frame.js → WAWebview.js → page-frame.js → generateFuncReady
└── iframe /__wxa__/webview/pages/b/b.html?id=2
```

渲染层 URL 与页面路径一致，wxml 中的相对资源路径（`../../images/a.png`）因此能按小程序规则解析。

#### 注入 iframe 的脚本（frame.ts）

必须在基础库之前执行：

1. **预置全局变量**：`__wxAppCode__`、`__wxRoute`、`WeixinWorker`、`__global` 等，基础库依赖它们
2. **`__passWAServiceGlobal__(globals)`**：基础库初始化完成后通过它交出 `App` / `Page` / `Component` /
   `wx` / `define` / `require`，没有这个函数这些全局对象不会出现
3. **WeixinJSBridge**：基础库检测到已存在的全局 `WeixinJSBridge` 时直接使用它
4. **渲染层设备模拟**：
   - `screen.width` / `devicePixelRatio` 改为模拟设备的值
   - `screen.orientation` 固定为竖屏。桌面浏览器报告横屏时，基础库会改用 `screen.height` 作为设备宽度，导致 rpx 换算错误
5. **鼠标 → 触摸**：页面只应收到触摸事件。基础库在部分版本/平台上会自己把鼠标或 pointer 事件转换为触摸，
   和我们的转换叠加会触发两次 tap，所以在 window 捕获阶段最先拦下鼠标类事件再统一转换。
   另外基础库在元素滚动后 50ms 内会取消 tap，自动化测试的「滚动到元素 → 立刻点击」会因此失效，
   转换时先等两帧让 scroll 事件派发完，必要时顺延
6. **内置组件样式提前注入**：基础库在文档没加载完时把内置组件样式（`wx-view` 的 display、`wx-canvas` 的默认尺寸等）
   推迟到 `window.onload` 注入。开发者工具在文档加载完后才注入基础库，那边是立即注入；这里基础库随页面同步加载，
   首屏渲染早于 onload，canvas 这类挂载时测量尺寸的组件会量错。所以加载完成前赋给 `window.onload` 的回调改为立即执行

#### 消息协议

宿主与 iframe 同源，iframe 内的桥直接调用 `window.parent.__wxaHost`，不经过 postMessage。
这让同步 API（`getStorageSync` 等）可以同步返回。

| 方向 | 基础库调用 | 宿主处理 |
| --- | --- | --- |
| 逻辑层 → 渲染层 | `WeixinJSBridge.publish(event, data, webviewIds)` | 克隆到目标 iframe 的 realm 后，在微任务中调用渲染层的 subscribe 回调；`webviewIds` 为空时发给所有页面（旧版 canvas 的绘制指令就这样发，靠 canvasNumber 找到画布） |
| 渲染层 → 逻辑层 | `WeixinJSBridge.publish(event, data)` | 同上，附带来源 webviewId |
| 任一层 → 原生 | `WeixinJSBridge.invoke(api, args, callback)` | 交给 API 注册表；结果能同步得到时**同步回调**（基础库在带 `type` 参数的 `getSystemInfo` 等调用上依赖这一点） |
| 原生 → 逻辑层 | `WeixinJSBridge.on(event, cb)` | `onAppRoute`、`onAppRouteDone`、`on*TaskStateChange`、`onAppEnterForeground` 等 |
| 原生 → 渲染层 | `WeixinJSBridge.on(event, cb)` | 原生组件的事件：`onMultiPickerViewChange`、`onWebviewStartLoad` / `onWebviewFinishLoad` |

数据通过 `目标window.JSON.parse(JSON.stringify(data))` 在目标 iframe 的 realm 中重建，
避免跨 realm 的 `instanceof Array` 判断失效。原生接口的结果和事件里可能有 ArrayBuffer（`readFile` 读到的文件、下载的音频），
JSON 会把它变成 `{}`，所以单独复制成目标 realm 的 ArrayBuffer；`setData` 等消息数据量大，不做这一步。

> 与最初方案的差异：最初设计中的命令字 `APPSERVICE_PUBLISH` / `WEBVIEW_PUBLISH` / `APPSERVICE_INVOKE` /
> `APPSERVICE_ON_EVENT` 是开发者工具内部 postMessage 的消息名；基础库本身面对的是上表中的 WeixinJSBridge 接口，
> 宿主直接实现这一层即可。

#### 路由与生命周期

宿主不实现任何生命周期，只维护页面栈并派发 `onAppRoute`，生命周期由基础库驱动：

```
navigateTo(url)
  1. 页面栈已满（10 层）→ fail
  2. 创建渲染层 iframe，等待 generateFuncReady 执行完
  3. 压栈、切换显示、更新导航栏 / tabBar / 地址栏
  4. 派发 onAppRoute { path, query, openType: 'navigateTo', webviewId }
     → 基础库执行 onHide / onLoad / onShow，推送初始数据，渲染完成后 onReady
  5. 300ms 后若仍是当前页面，派发 onAppRouteDone
```

- 基础库调用路由 API 时，url 已解析为根路径并带 `.html`（如 `pages/a/a.html?id=1`），宿主只做格式归一
- 路由操作串行执行，避免连续跳转时页面栈错乱
- tabBar 页面实例缓存，`switchTab` 回来时不重新创建；`reLaunch` 清空包括 tabBar 在内的所有页面

#### 原生 API

| 模块 | 内容 |
| --- | --- |
| storage | localStorage，按 appid 和 storageId 隔离；原样保存基础库序列化后的数据和 dataType；渲染层用的 GlobalStorage（cookie） |
| system | 以模拟设备（默认 iPhone X，375×812 @3x）为准的 getSystemInfo 及 windowInfo / deviceInfo / appBaseInfo 等 |
| network | `createRequestTask` 同步返回 taskId，结果通过 `onRequestTaskStateChange` 依次推送 `headersReceived`、`success` / `fail`；下载、上传、WebSocket 同理 |
| ui | toast / loading / modal / actionSheet / 导航栏 |
| media | 选图（chooseImage / chooseMedia）、previewImage、getImageInfo、saveImageToPhotosAlbum，见下文「原生组件」 |
| audio | 原生音频接口（createAudioInstance、setAudioState、operateAudio 等），3.3.x 及更早版本的 InnerAudioContext 用，见下文「原生组件」 |
| picker | picker 组件的选择器弹层，见下文「原生组件」 |
| webView | web-view 组件的网页视图，见下文「原生组件」 |
| savedFiles | 保存的文件：saveFile、getSavedFileList / getSavedFileInfo、removeSavedFile，见下文「原生组件」 |
| libFiles | 渲染层按需加载基础库文件（`loadLibFilesSync`），3.3.x、3.5.x 的 video 等组件用，见下文「原生组件」 |
| misc | 内存文件系统（基础库会往 `http://usr/` 写运行日志；`readFile` 读代码包里的文件时向开发服务器取）、临时文件、登录等开放接口的模拟数据、剪贴板 |
| 路由 | 由 Host 实现 |

未实现的 API 默认返回 `:ok` 并在控制台提示一次；基础库内部的上报类调用静默处理。
其中业务代码调用的（逻辑层发起、名字在 `wx` 上）还会记入测试 API 的 `errors()`，每个 API 一次；
基础库内部调用的原生接口（如 `getAppContact`）不记，因为业务既没调用也 mock 不了。
测试中可以用 `__wxa_test_api__.mock()` 覆盖任意 API。

#### 原生组件

渲染层上报的平台是 `devtools`，基础库对大多数原生组件改用开发者工具里的网页实现，宿主不用参与：

| 组件 | 实现 | 状态 |
| --- | --- | --- |
| canvas（2d / webgl / 旧版 canvas-id）、video、map、camera、audio | 基础库的网页实现：`<canvas>`、`<video>`、腾讯地图网页 SDK、`getUserMedia` | ✅ map 需要联网；camera 需要浏览器授权摄像头；video 的 src 只能是 http(s)，3.3.x、3.5.x 的 video 按需加载（见下） |
| cover-view、cover-image、input、textarea、picker-view、editor | 基础库的网页实现 | ✅ |
| picker | 宿主弹出选择器（`showPickerView` 等） | ✅ |
| web-view | 宿主在页面里嵌入 iframe（`insertHTMLWebView` 等） | ✅ 有限制，见下 |
| live-player | 渲染出 `<video>`，播放走的 `operateLivePlayer` 没有实现，浏览器也不能播 RTMP | ⏳ |
| live-pusher、voip-room | 基础库显示「IDE 暂不支持」，与开发者工具一致 | — |
| open-data、ad | open-data 渲染为空；ad 走广告失败分支（见伴生 SDK 子包） | — |

几个需要宿主配合的地方：

- **选择器**：基础库把各列的选项文字交给宿主，宿主从底部弹出选择器，按约定格式返回用户的选择。
  日期的天数随年月变化、start/end 限制、省市区逐级联动在 `api/picker.ts` 里实现，弹层（`ui/Picker.ts`）只负责显示列。
  多列选择器打开期间用户换列时，向渲染层派发 `onMultiPickerViewChange`，页面改了 range 后基础库调 `updateMultiPickerView` 换掉那一列。
  地区选择器的行政区划数据取自本机开发者工具（`js/libs/region_sub_strict*`，新版在 `app.asar` 里），和基础库一样不随项目分发
- **web-view**：网页放在所在页面渲染层里的 iframe 中，跟着页面显示、隐藏和关闭。设置了 X-Frame-Options 或
  CSP frame-ancestors 的网站不允许被嵌入，显示不出来；网页里的 `wx.miniProgram` 接口不可用。
  网页内自己跳转时，同源网页报告新地址并触发 load，跨域网页读不到地址就不报；iframe 加载失败没有事件，binderror 不会触发。
  基础库拿到空的业务域名列表时会把 web-view 事件里的网页地址清空，所以拉取业务域名列表（`operateWXData` 的
  `webapi_getwxanetwork`）明确返回失败，基础库因此不做校验，等同开发者工具的「不校验业务域名」
- **临时文件**：canvas 导出、拍照、录像的结果（经 `base64ToTempFilePath`）、选中的图片、`downloadFile` 下载的文件都存到开发服务器，返回 http 地址。
  image、video 组件只原样使用 http(s) 地址，`blob:` 之类的地址会被当成页面相对路径。
  旧版 canvas 的 `drawImage` 正好相反：基础库把 http(s) 地址都当成网络图片直接跳过（只放行开发者工具的 `http://tmp/` 等），
  不报错，画布上什么也没有。所以宿主转发绘制指令（`canvasActionsChanged`）时，把其中的临时文件地址换成根路径 `/__wxa__/tmp/…`，
  页面和组件里都按开发服务器的根目录解析
- **选图**：「从手机相册选择」和「拍摄」都打开浏览器的文件选择框（拍摄带 `capture`，手机浏览器上会打开相机）。
  和真机一样，两种来源都可选时先弹菜单。浏览器只允许在用户点击后的几秒内打开文件选择框（页面里的点击也算，会传到宿主页），
  没有经过点击就调用时也先弹菜单，用户点菜单就是一次点击；否则选择框打不开，回调永远不来。
  `chooseMedia` 只支持图片。`previewImage` 是宿主的全屏预览层，`saveImageToPhotosAlbum` 让浏览器下载这张图片
- **音频（InnerAudioContext）**：3.5.8 起平台是 devtools 时基础库用 Web Audio 播放，先把音频读成 ArrayBuffer。
  网络音频经带 `__skipDomainCheck__` 的内部请求下载，宿主按请求的形状（`responseType` 为 `arraybuffer` 且带 `enableCache`，
  2.32.3 到 3.17.4 都是这样）只放行这一种，经代理下载；代码包里的音频经 `readFile` 向开发服务器读取。
  3.3.x 及更早版本默认调原生接口（`createAudioInstance`、`setAudioState`、`operateAudio` 等；业务指定 `useWebAudioImplement` 时同样用 Web Audio），宿主用 `<audio>` 实现：
  时间以毫秒为单位；基础库每次改属性都带上全部状态，其中的进度是旧值，只取 src、音量等能设置的属性；
  timeupdate 由基础库轮询 `getAudioState` 产生。浏览器缓冲后只派发 playing，所以把 playing 当作 play 推送，
  否则基础库把 waiting 当作暂停、不再更新进度；播到结尾时浏览器先派发的 pause 不推送
- **按需加载的组件**：3.3.x、3.5.x 的 video 等组件放在单独的基础库文件里，渲染层用到时调 `loadLibFilesSync`。
  宿主同步读取文件，脚本在调用返回前于渲染层执行完（基础库在调用前后设置、清理 `window.__Behaviour` 等全局变量），
  各文件的内容按顺序放在 `__codes` 里交回，基础库从中取 CSS 自己插入。逻辑层也会调它加载伴生 SDK，那条路照旧只返回成功（见下文「伴生 SDK 子包」）
- **保存的文件**：`getFileInfo` 向开发服务器查临时文件的大小（不返回 digest）。`saveFile` 和真机一样把临时文件存成新文件、删掉原来的，
  新文件也在开发服务器上，image 能直接显示。保存记录写在 Storage 里，同样按 appid 隔离、整页刷新后还在；开发服务器重启后文件没了，
  记录随之失效，`getSavedFileInfo` 报文件不存在，Painter 等用它做缓存的库会重新下载。FileSystemManager 的 `saveFile`
  指定 `filePath` 时直接失败：那是内存文件系统，存不了图片等二进制内容；`saveFileSync` 没有实现

#### 伴生 SDK 子包

上面的兜底只覆盖走 `WeixinJSBridge.invoke` 的调用。另有一类能力实现在基础库内部，
由一组伴生文件提供，真机和开发者工具由原生层调用 `loadMainContextLibFile` 把它们
同步加载进逻辑层上下文，再把导出挂到约定的全局名上：

| 全局名 | 伴生文件 | 能力 |
| --- | --- | --- |
| `ADSDK` | WAAppAd.js | 广告 |
| `__cloudSDKMain__` / `__sclEngine__` | WACloud.js / WASubAppSclEngine.js | 云开发 |
| `MidasSDK` / `OrderMidasSDK` | WAMidasSDK.js / WAOrderMidasSDK.js | 米大师支付 |
| `__splashAdFloatWindowSDK__` / `__progneSDK__` | WASplashAdFloatWindow.js / WAProgneService.js | 开屏广告浮窗 |

运行时没有这套加载机制。缺失不会直接抛到业务代码——基础库把内部异常包成
`appServiceSDKScriptError` 自己吞掉，于是 `wx.createRewardedVideoAd()` 返回 `undefined`，
崩的是下一行业务代码的 `ad.onError(...)`。所以占位（`runtime/sdkStubs.ts`）放在 `wx` 这一层，
返回接口齐全、`load`/`show` 必定失败的广告对象，业务代码走自己的广告失败分支。

装占位的时机只有一个窗口：基础库初始化完会把这些接口改成返回 `undefined` 的函数，
占位要在业务代码执行前装。做法是在基础库加载前用存取器占住 `globalThis.require`，
bootstrap 每次 require 业务模块时先装一遍（`installApiStubs` 幂等）。

不事后包装 `require`、也不让生成的 bootstrap 去调运行时包里的全局：基础库交出全局的方式
按版本而异（3.7.0 直接写 `globalThis`，并不调 `__passWAServiceGlobal__`），事后包装没有
可靠时机；而让 bootstrap 依赖运行时包的全局，会在 `dist/runtime` 没跟着重新构建时
直接 ReferenceError 崩掉整个小程序。

不给 `SkylineGlobal` / `NativeGlobal` / `xrFrame` / `WeixinJSContext` 这类全局打桩——
基础库对它们做 `typeof` 检测，补上会让它走进依赖更多的分支，比缺失更糟。

### 5. 服务层（core/server）

| 路由 | 内容 |
| --- | --- |
| `/` | 宿主页面 |
| `/__wxa__/app-info.json` | 构建信息；构建失败时返回 `buildError`，宿主显示错误 |
| `/__wxa__/appservice.html?path=&query=` | 逻辑层；`path` 写入 `appLaunchInfo` |
| `/__wxa__/webview/<page>.html?id=` | 渲染层 |
| `/__wxa__/module/<file>.js` | 单个业务模块 |
| `/__wxa__/service-bootstrap.js`、`/__wxa__/page-frame.js` | 构建产物 |
| `/__baselib__/*` | 解包后的基础库 |
| `/__wxa__/proxy?url=` | 网络代理 |
| `/__wxa__/tmp` | 临时文件：`POST ?type=png` 保存，返回可直接访问的地址；随服务器进程存在 |
| `/__wxa__/region/<districts\|streets>` | 地区选择器用的行政区划数据，取自本机开发者工具 |
| `/__wxa__/ws` | 文件变化 / 编译错误通知 |
| 其他 | 小程序目录下的静态资源 |

**网络代理**：小程序设置的请求头放在 `x-wxa-headers`（JSON）里传给代理，cookie、referer 等浏览器
禁止设置的请求头因此也能带上；响应头和 `set-cookie` 以 URL 编码的 JSON 返回。代理只监听本机地址，
用于开发环境。只转发小程序自己的请求：基础库自己的请求（数据上报、配置拉取等，带 `__skipDomainCheck__` 标记）
直接按失败返回，不发往网络，也不记入 `requests()`。唯一的例外是 InnerAudioContext 下载音频（见「原生组件」），同样不记入 `requests()`。

---

## 🔄 数据流

### 启动

```
1. 浏览器打开 /，host.js 读取 /__wxa__/app-info.json
2. 创建逻辑层 iframe：frame.js 准备全局变量和桥 → WAService.js 初始化
   → __passWAServiceGlobal__ 交出 App/Page/define/require
   → 加载业务模块（define）→ service-bootstrap.js 注册 json/wxml，require app.js、组件、页面
   → App.onLaunch / onShow
3. 宿主创建首页渲染层 iframe：WAWebview.js → page-frame.js → generateFuncReady
4. 宿主派发 onAppRoute(openType: appLaunch)
5. 基础库执行 Page.onLoad / onShow，通过 publish 把初始数据发给渲染层
6. 渲染层 exparser 创建节点树；逻辑层收到渲染完成后执行 onReady
```

### 用户点击

```
鼠标按下/抬起 → frame.js 转换为 touchstart/touchend
→ 渲染层 exparser 识别 tap，publish 事件到逻辑层
→ 基础库调用页面方法（如 handleTap），业务代码 setData
→ 逻辑层 publish 数据变更到渲染层 → exparser 更新 DOM
```

### 文件变化

```
chokidar → 按文件类型标记需要重新编译的部分 → 增量编译
→ 成功：WebSocket 通知 reload，浏览器刷新后按地址栏的 ?path= 回到当前页面
→ 失败：WebSocket 推送编译器错误，宿主覆盖显示；修复后自动恢复
```

---

## 🎨 技术选型

| 维度 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript | 类型安全 |
| 包管理 | pnpm workspace | Monorepo |
| HTTP 服务器 | Express | 简单、中间件成熟 |
| WebSocket | ws | 轻量 |
| 文件监听 | chokidar | 跨平台 |
| ESM 转换 | esbuild | 快，带 source map |
| 构建 | tsup | Node 端 cjs + esm；浏览器端 iife |
| 测试 | Vitest + Playwright | 单元、集成、真实浏览器 e2e |

---

## 🚀 实施路线图

### Phase 1：MVP ✅

- [x] 项目结构搭建
- [x] 提取官方基础库（从本机开发者工具解包 `.wxvpkg`，按版本缓存）
- [x] 封装 wcc / wcsc 编译器（命令行版本，支持自定义组件配置）
- [x] 宿主容器（Host + 手机外壳 UI）
- [x] 消息桥接（WeixinJSBridge：invoke / publish / subscribe / on）
- [x] 路由栈管理
- [x] Storage 适配器
- [x] Hello World 示例

**验收**：`wxa-runner dev examples/hello-world`，点击按钮触发 setData 更新 —— 已通过。

### Phase 2：完善核心功能 ✅（附已知限制）

- [x] Network 适配器（request / downloadFile / uploadFile / connectSocket，经代理转发）
- [x] UI 适配器（toast / loading / modal / actionSheet / 导航栏）
- [x] 热更新（自动重新编译并刷新，保留当前页面路由；不保留页面内存状态）
- [x] tabBar
- [x] 自定义组件（含 npm 组件、全局组件、抽象节点）
- [x] wxs
- [x] 单元测试：语句覆盖率 90%、分支 83%（统计范围不含只在浏览器中运行的代码，这部分由 e2e 覆盖）
- [x] 集成测试与 e2e 测试

**验收**：
- 真实 uni-app（Vue 3）编译产物可运行：unibest（14 个组件）、uni-preset-vue-vite
- 页面跳转、tabBar、网络请求（真实 API）、Storage 持久化、修改代码后自动刷新 —— 均已通过
- 2.32.3 / 3.3.4 / 3.5.8 / 3.7.0 四个基础库版本跑通同一套 e2e 场景

**已知限制**（后续工作）：
- live-player、live-pusher、voip-room、open-data 等原生组件（canvas、video、map、camera、picker、web-view 已支持，见「原生组件」）；蓝牙等设备能力
- 插件、分包异步化、Worker
- 页面内存状态保持的热更新

### Phase 3：Playwright 集成 ✅

- [x] Mock 注入 API（`__wxa_test_api__.mock`）
- [x] 当前页标记：`iframe[data-current]` 始终指向当前页，跨跳转可直接用 `page.frameLocator`
- [x] `window.__wxa_test_api__` 的全局类型声明（`@open-wxa/wxa-runner-core/test-api`）
- [x] 测试最佳实践文档（[docs/testing.md](./docs/testing.md)）
- [x] `@open-wxa/wxa-runner-playwright`（[#4](https://github.com/open-wxa/wxa-runner/issues/4)）

起初认为服务器生命周期交给 Playwright 自带的 `webServer`、错误检查写一行 `afterEach` 就够，暂缓了单独发包。
实际使用中出现了文档和配置表达不了的需求，于是做成 fixture：

- 多个 worker 并行时，端口和服务器生命周期要自己管：fixture 每个 worker 启动一个 DevServer（随机端口）
- 浏览器里的运行时和测试代码引用的类型可能不是同一个版本：core 作为 fixture 的普通依赖，由 fixture 启动服务器
- `page.evaluate` 只读一次，跳转后要手动 `waitForPage`：`toHavePath` / `toHavePageData` 自动重试
- `network.routes` 在浏览器里匹配，命中的请求不经过代理，Playwright 拿不到请求体：宿主在匹配之前记录每个
  `wx.request`，`requests()` / `waitForRequest()` 读取
- Node 侧执行的 mock / route 处理函数：经 `page.exposeFunction` 的通道调用。只能异步返回结果，所以同步 API 只能 mock 成对象
- 启动阶段就调用的 API：宿主在 setup 之后、启动前执行 `window.__wxa_before_launch__`，fixture 在这里按顺序重放
  Node 侧记下的 mock / unmock / route / unroute，打开页面前声明的在 `App.onLaunch` 里就生效，整页重新加载后状态不变

说明只写在类型注释里：`WxaTestApi` 和 `MiniProgram` 的每个成员都有注释（fixture 转发的成员经映射类型复用 core 的注释），
单元测试检查每个成员都有注释、测试 API 的每个成员都写进了 docs/testing.md 的表格。

还没做的：按 WXML 标签名和组件样式隔离前缀选择元素。

### Phase 4：生产优化（预计 2 周）

- [x] 支持 3.7.1+ 基础库（模拟 WeixinJSContext 隔离上下文，[#9](https://github.com/open-wxa/wxa-runner/issues/9)）；默认仍选 ≤ 3.7.0
- [x] 原生组件：canvas、picker、web-view、临时文件（live-player 等见 Phase 2 已知限制）
- [ ] 多实例并行、Docker 部署
- [ ] 性能与压力测试

### Phase 5：社区建设（持续）

---

## 📝 开发规范

- 使用 ESLint + Prettier 统一代码风格
- 关键逻辑必须有测试；浏览器端行为用 e2e 覆盖
- Commit 遵循 [Conventional Commits](https://www.conventionalcommits.org/)

---

## 🤔 设计权衡

### 1. 为什么不直接使用微信开发者工具？

开发者工具基于 NW.js，依赖桌面环境，难以在 CI 和无头浏览器中使用，也无法被 Playwright 直接驱动。
我们只复用其中的核心运行时（基础库 + 编译器），抛弃桌面壳。

### 2. 为什么使用 iframe 而不是 Web Worker？

渲染层需要 DOM；逻辑层的基础库也假设运行在有 `window` / `document` 的环境中（开发者工具里同样是网页）。
同源 iframe 还让同步 API 可以直接同步调用宿主。

### 3. 为什么不重新实现基础库？

工作量巨大且难以保证一致。实践也证明了这一点：本项目最初的实现自己模拟了 App/Page 和渲染，
无法支持 setData 之外的大部分能力；换成官方基础库后，组件、wxs、事件系统都直接可用。

### 4. 为什么基础库和编译器不随项目分发？

它们的版权属于腾讯。从用户本机已安装的开发者工具中读取，既避免分发问题，也让用户可以自由切换版本。

---

**版本**：v1.2（2026-10-14，补充原生组件）
