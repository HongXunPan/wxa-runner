/**
 * 宿主、逻辑层、渲染层的 HTML
 */

import { BuildResult, toJs } from '../project/AppBuilder';

export function hostHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>wxa-runner</title>
</head>
<body>
  <div id="wxa-root"></div>
  <script src="/__wxa__/runtime/host.js"></script>
</body>
</html>`;
}

export function appserviceHtml(build: BuildResult, launch: { path: string; query: Record<string, string> }): string {
  const wxConfig = {
    ...build.wxConfig,
    appLaunchInfo: { scene: 1001, path: launch.path, query: launch.query }
  };
  const v = build.version;
  const modules = build.modules
    .map(id => `<script src="/__wxa__/module/${encodeURI(id)}?v=${v}"></script>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>appservice</title>
<script>var __wxConfig = ${toJs(wxConfig)};</script>
<script src="/__wxa__/runtime/frame.js" data-kind="service"></script>
<script src="/__baselib__/WAService.js"></script>
<script>
if (typeof define !== 'function') {
  console.error('[wxa-runner] 基础库没有完成初始化（define 不存在），当前基础库版本可能不受支持');
}
</script>
${modules}
<script src="/__wxa__/service-bootstrap.js?v=${v}"></script>
<script>parent.__wxaHost.frameLoaded('service', 0);</script>
</head>
<body></body>
</html>`;
}

export function webviewHtml(build: BuildResult, pagePath: string, webviewId: number): string {
  const pageConfig = build.wxConfig.page?.[pagePath + '.html'];
  const window = { ...build.wxConfig.global?.window, ...pageConfig?.window };
  const wxConfig = { ...build.wxConfig, window };
  const id = Number(webviewId) || 0;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${escapeHtml(pagePath)}</title>
<!-- 小程序渲染层的默认字号是 16px；不声明的话会继承浏览器设置里的默认字号。放在最前面，基础库和页面样式都能覆盖它 -->
<style>html{font-size:16px}</style>
<script>var __wxConfig = ${toJs(wxConfig)};</script>
<script src="/__wxa__/runtime/frame.js" data-kind="webview" data-webview-id="${id}"></script>
<script src="/__baselib__/WAWebview.js"></script>
<script src="/__wxa__/page-frame.js?v=${build.version}"></script>
${window.disableScroll ? '<style>body{overflow-y:hidden}</style>' : ''}
</head>
<body>
<script>
(function () {
  var path = ${toJs(pagePath)};
  if (typeof __wxAppCode__[path + '.wxss'] === 'function') __wxAppCode__[path + '.wxss']();
  var generateFunc = $gwx('./' + path + '.wxml');
  if (generateFunc) {
    document.dispatchEvent(new CustomEvent('generateFuncReady', { detail: { generateFunc: generateFunc } }));
  } else {
    document.body.innerText = './' + path + '.wxml not found';
    console.error('[wxa-runner] ./' + path + '.wxml not found');
  }
  parent.__wxaHost.frameLoaded('webview', ${id});
})();
</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}
