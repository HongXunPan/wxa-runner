# 命令与环境变量

## wxa-runner dev

```
wxa-runner dev <project-path>
  -p, --port <port>         端口号（默认 3000）
  --host <host>             监听地址（默认 localhost）
  -b, --baselib <version>   基础库版本（默认使用可用的最新兼容版本）
  --setup <file>            启动前执行的 setup 文件（默认使用项目目录下的 wxa.setup.ts / .js / .mjs）
  --no-setup                不执行 setup 文件
  --no-watch                不监听文件变化
  -o, --open                启动后打开浏览器
  --real-login              用本机开发者工具的登录态获取真实的 wx.login code 和手机号
```

- `<project-path>` 是小程序目录：原生项目，或 uni-app、Taro 等框架编译出的 `mp-weixin` 目录
- 跑测试时加 `--no-watch`：不开启热更新，运行环境与真机一致
- 地址带上 `?path=` 可以直接打开指定页面，其余参数作为页面参数，如 `http://localhost:3000/?path=pages/detail/detail&id=1`
- `--setup` 见 [setup.md](./setup.md)，`--real-login` 见 [setup.md#真实登录](./setup.md#真实登录)

## wxa-runner baselib

```
wxa-runner baselib list               列出可用的基础库（本机已下载的和内置的）及兼容性
wxa-runner baselib extract [version]  解包基础库到 ~/.wxa-runner/baselib（dev 会自动执行；内置基础库无需解包）
```

基础库的来源：本机微信开发者工具下载过的版本优先；没有时用随依赖安装的内置基础库 3.7.0
（[wxa-baselib](https://github.com/open-wxa/wxa-baselib)）。不指定版本时选最新的兼容版本。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `WXA_DEVTOOLS_PATH` | 开发者工具不在默认位置时，指定安装目录（如 macOS 上的 `.app` 目录），新旧版本都可以 |
| `WXA_VENDOR_DIR` | 指定基础库目录（开发者工具的 `WeappVendor`） |
| `WXA_BASELIB` | 没有用 `--baselib` 指定时使用的基础库版本 |
| `WXA_WCC` / `WXA_WCSC` | 直接指定编译器，优先于开发者工具和 miniprogram-compiler |
| `WECHAT_DEV_TICKET` | `--real-login` 使用的开发者 ticket，优先于开发者工具的登录态 |
| `WECHAT_DEVTOOLS_CLI_TOKEN` | 开发者工具设置了「CLI 访问令牌」时，`--real-login` 调用开发者工具命令行要用它 |
| `WXA_*` | 传给 setup 文件，见 [setup.md](./setup.md) |
