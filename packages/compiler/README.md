# @open-wxa/wxa-runner-compiler

[wxa-runner](https://github.com/open-wxa/wxa-runner) 的内部包：调用微信官方的 WXML / WXSS 编译器（wcc / wcsc）。
一般不需要直接安装，用 [`wxa-runner`](https://www.npmjs.com/package/wxa-runner) 即可。

编译器依次从这些位置查找：

1. 环境变量 `WXA_WCC` + `WXA_WCSC`
2. 本机微信开发者工具（不在默认位置时用 `WXA_DEVTOOLS_PATH` 指定）
3. 随依赖安装的 [miniprogram-compiler](https://www.npmjs.com/package/miniprogram-compiler)，Linux 只支持 x86-64
