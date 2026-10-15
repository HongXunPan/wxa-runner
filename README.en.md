# wxa-runner

> Run WeChat Mini Programs in a regular browser on the **official base library**. Built for local debugging and end-to-end testing.

English · [中文](./README.md)

```bash
wxa-runner dev ./dist/dev/mp-weixin   # a native mini program, or uni-app / Taro build output
# → http://localhost:3000
```

Only base library 3.7.0 and below is supported, and the package is not on npm yet. See [Known limitations](#known-limitations) for the rest.

## Why wxa-runner

- **Matches the real thing**: runs the mini program build output directly; rendering, components, `setData` and lifecycles are WeChat's official base library code, not a framework's H5 reimplementation
- **Headless E2E**: test in the browser with Playwright instead of remote-controlling DevTools; runs headless in CI, and needs no DevTools on Linux
- **Hot reload that keeps state**: edits to WXML and JS apply in place without a page refresh; the page stack and global state survive, so there is no clicking back to where you were
- **Familiar debugging tools**: breakpoints, network requests and the DOM in Chrome DevTools
- **Skip what a browser cannot do**: seed the login state, mock native APIs and intercept requests in setup, without touching app code
- **Open any page directly**: add `?path=pages/detail/detail&id=1` to the URL to land on a page during development and in tests

It does not replace DevTools: previewing, uploading and on-device debugging still need it.

## Quick start

Requires Node.js ≥ 18 and pnpm ≥ 8. Not on npm yet ([#3](https://github.com/open-wxa/wxa-runner/issues/3)), so build from source:

```bash
git clone https://github.com/open-wxa/wxa-runner.git
cd wxa-runner
pnpm install && pnpm build
node packages/cli/bin/wxa-runner.js dev examples/showcase --open
```

```
[wxa-runner] 编译完成：3 个页面，1 个组件，17ms

  wxa-runner 已启动
  地址      http://localhost:3000
  项目      /path/to/wxa-runner/examples/showcase
  基础库    3.7.0
```

The CLI currently prints in Chinese. No separate setup for the base library or the compiler: wxa-runner uses WeChat DevTools' copies when installed, and bundled ones installed as dependencies otherwise.
See [docs/cli.md](./docs/cli.md) (in Chinese) for command options and environment variables.

## Usage

### Skip login

Put a `wxa.setup.ts` next to `project.config.json`; it runs before the mini program starts:

```ts
import { defineSetup } from '@open-wxa/wxa-runner-core/setup';

export default defineSetup(({ env }) => ({
  storage: { token: env.WXA_TOKEN },                              // seed storage
  mock: { getLocation: { latitude: 31.23, longitude: 121.47 } },  // override native APIs
  network: {                                                      // intercept wx.request
    routes: { 'POST **/api/auth/login': { body: { token: env.WXA_TOKEN } } }
  }
}));
```

For a real login code or phone number, start with `--real-login`. See [docs/setup.md](./docs/setup.md) (in Chinese).

### Hot reload

| Change | Effect |
| --- | --- |
| A page's or component's own `.wxml` and `.js` | Hot update without a page refresh; the page stack and global state are kept |
| Anything else (`app.js`, `.json`, `.wxss`, …) | Full reload that restores the whole page stack |

See [docs/hot-reload.md](./docs/hot-reload.md) (in Chinese).

### Testing with Playwright

Start the server with `wxa-runner dev <project> --no-watch`, then open it from a test:

```ts
/// <reference types="@open-wxa/wxa-runner-core/test-api" />
import { test, expect } from '@playwright/test';

test('navigates to the result page after submitting', async ({ page }) => {
  await page.goto('http://localhost:3000/?path=pages/form/form');
  await page.evaluate(() => window.__wxa_test_api__.ready);

  const current = page.frameLocator('iframe[data-current]');  // always the current page
  await current.locator('#submit').click();

  await page.evaluate(() => window.__wxa_test_api__.waitForPage('pages/result/result'));
  await expect(current.locator('.result-title')).toHaveText('Submitted');
});
```

See [docs/testing.md](./docs/testing.md) (in Chinese) for the test API, types and caveats.

## Features

| Area | Supported |
| --- | --- |
| Rendering | WXML, WXSS, WXS, custom components, App / Page / Component lifecycles |
| Routing | navigateTo, redirectTo and the other page routes, a 10-level page stack, tab bar |
| UI | Navigation bar, tab bar, toast / modal / actionSheet; iPhone X by default |
| Components | picker, canvas, camera, web-view |
| Network | request, upload and download through a proxy (no CORS limits), WebSocket |
| Storage | Storage, basic FileSystemManager operations |

Verified on real uni-app (Vue 3) projects; verified base library versions: 2.32.3, 3.3.4, 3.5.8, 3.7.0.

## Known limitations

- Base library 3.7.0 at most ([#9](https://github.com/open-wxa/wxa-runner/issues/9))
- Unimplemented native APIs return success, with only a console warning ([#2](https://github.com/open-wxa/wxa-runner/issues/2))
- No video, map, audio or Bluetooth, and no media pickers such as `chooseImage` ([#7](https://github.com/open-wxa/wxa-runner/issues/7), [#8](https://github.com/open-wxa/wxa-runner/issues/8))
- No plugins, async subpackages or Workers ([#10](https://github.com/open-wxa/wxa-runner/issues/10))
- Without WeChat DevTools (on Linux or in CI, say): x86-64 only; the compiler is older, with small template-runtime differences (such as a limit of 16,000 nodes per page); the region picker is unavailable

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) (in Chinese). Issues and PRs are welcome.

## Acknowledgements

- The WeChat team, for the official base library and compilers
- [WEPT](https://github.com/chemzqm/wept), the first project to show that mini programs can run in a browser

## License

[MIT](./LICENSE). The bundled base library, [wxa-baselib](https://github.com/open-wxa/wxa-baselib), is WeChat's official code; its copyright belongs to Tencent, and the MIT license of this project does not apply to it.
