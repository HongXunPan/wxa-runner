# @open-wxa/wxa-runner-extractor

[wxa-runner](https://github.com/open-wxa/wxa-runner) 的内部包：查找、选择并解包微信官方基础库。
一般不需要直接安装，用 [`wxa-runner`](https://www.npmjs.com/package/wxa-runner) 即可。

本机微信开发者工具下载过的版本优先；没有时用随依赖安装的内置基础库 [wxa-baselib](https://github.com/open-wxa/wxa-baselib)，
它从 GitHub 安装，需要本机有 git、能访问 github.com。相关环境变量见
[docs/cli.md](https://github.com/open-wxa/wxa-runner/blob/main/docs/cli.md#环境变量)。
