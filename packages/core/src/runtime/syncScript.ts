/**
 * 同步执行脚本：与开发者工具的 loadLibFiles 一致，同步请求脚本内容，以内联脚本执行
 */

/** @throws 状态码不是 200 */
export function readSync(url: string): string {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.send();
  if (xhr.status !== 200) throw new Error(`[wxa-runner] 加载 ${url} 失败：${xhr.status}`);
  return xhr.responseText;
}

/** 在 win 里执行完才返回；DevTools 里显示为 url 这个文件 */
export function runScript(win: Window, url: string, code: string) {
  const href = new URL(url, location.href).href;
  // 基础库文件同样加入 DevTools 的忽略列表（见 server/ignoreList.ts）
  const sourceMap = url.startsWith('/__baselib__/') ? `\n//# sourceMappingURL=${href}.map` : '';
  const script = win.document.createElement('script');
  script.text = `${code}\n//# sourceURL=${href}${sourceMap}`;
  win.document.head.appendChild(script);
}
