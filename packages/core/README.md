# @open-wxa/wxa-runner-core

[wxa-runner](https://github.com/open-wxa/wxa-runner) 的开发服务器和浏览器端运行时。

一般不用直接安装：命令行用 [`wxa-runner`](https://www.npmjs.com/package/wxa-runner)，在 Playwright 中测试用
[`@open-wxa/wxa-runner-playwright`](https://www.npmjs.com/package/@open-wxa/wxa-runner-playwright)。以下情况把它加为开发依赖：

- setup 文件要类型提示：`import { defineSetup } from '@open-wxa/wxa-runner-core/setup'`，见
  [docs/setup.md](https://github.com/open-wxa/wxa-runner/blob/main/docs/setup.md)
- 不用 fixture、直接使用测试 API：`/// <reference types="@open-wxa/wxa-runner-core/test-api" />` 为
  `window.__wxa_test_api__` 提供类型，见 [docs/testing.md](https://github.com/open-wxa/wxa-runner/blob/main/docs/testing.md#直接使用测试-api)
- 在 Node 里启动开发服务器：

```ts
import { DevServer } from '@open-wxa/wxa-runner-core';

const server = new DevServer({ projectPath: './dist/dev/mp-weixin', port: 3000, watch: false });
const url = await server.start();
// …
await server.close();
```
