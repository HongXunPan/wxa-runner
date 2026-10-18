/**
 * 渲染层按需加载基础库文件：3.3.x、3.5.x 的 video 等组件不在 WAWebview.js 里，用到时才经 loadLibFilesSync 加载
 *
 * 脚本在调用返回前执行完：基础库在调用前后设置、清理 window.__Behaviour 等全局变量。
 * 各文件的内容按顺序放在 __codes 里交回，基础库从这里取 CSS 自己插入页面，所以 CSS 不当脚本执行。
 */

import { readSync, runScript } from '../../syncScript';
import { ApiHandler, ok } from './registry';

export interface LibFileApiOptions {
  windowOf: (webviewId: number) => Window | null | undefined;
}

export function createLibFileApis(options: LibFileApiOptions): Record<string, ApiHandler> {
  const loadLibFiles: ApiHandler = (args, { api, from, webviewId }) => {
    const win = from === 'webview' ? options.windowOf(webviewId) : null;
    // 逻辑层也会调（加载广告、云开发等伴生 SDK），由 sdkStubs 在 wx 这一层接住，这里照旧返回成功
    if (!win) return ok(api);
    const codes = (args.paths as string[]).map(file => {
      const url = `/__baselib__/${file}`;
      const code = readSync(url);
      if (file.endsWith('.js')) runScript(win, url, code);
      return code;
    });
    return ok(api, { __codes: codes });
  };

  return { loadLibFiles, loadLibFilesSync: loadLibFiles };
}
