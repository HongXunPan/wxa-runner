/**
 * web-view 组件背后的原生网页视图
 *
 * 渲染层的 web-view 组件调 insertHTMLWebView 占位，updateHTMLWebView 设置地址和位置，
 * 销毁时 removeHTMLWebView；加载进度通过渲染层的 onWebviewStartLoad / onWebviewFinishLoad
 * 告诉组件，组件据此触发 bindload。
 *
 * 网页放在所在页面渲染层里的 iframe 中，跟着页面显示、隐藏和关闭。
 * 设置了 X-Frame-Options 或 CSP frame-ancestors 的网站不允许被嵌入，这类网页显示不出来。
 */

import { ApiHandler, fail, ok } from './registry';

export interface WebViewApiOptions {
  /** 页面渲染层的 document，页面已关闭时为 undefined */
  documentOf(webviewId: number): Document | undefined;
  /** 派发给渲染层的原生事件（渲染层里 WeixinJSBridge.on 收到） */
  emitToWebview(webviewId: number, event: string, data: unknown): void;
}

interface Position {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function createWebViewApis({ documentOf, emitToWebview }: WebViewApiOptions): Record<string, ApiHandler> {
  // 三个接口都由网页所在的渲染层调用，到那个文档里按 htmlId 找；不另存引用，页面关闭时随文档一起释放
  const find = (webviewId: number, htmlId: unknown) =>
    documentOf(webviewId)?.querySelector<HTMLIFrameElement>(`iframe[data-wxa-html-id="${Number(htmlId)}"]`) ?? null;

  const reportStart = (webviewId: number, htmlId: number, src: string) =>
    emitToWebview(webviewId, 'onWebviewStartLoad', { htmlId, src, isMainFrame: true });
  const reportFinish = (webviewId: number, htmlId: number, src: string) =>
    emitToWebview(webviewId, 'onWebviewFinishLoad', { htmlId, src });

  const place = (frame: HTMLIFrameElement, position?: Partial<Position>) => {
    if (!position) return;
    for (const side of ['left', 'top', 'width', 'height'] as const) {
      if (typeof position[side] === 'number') frame.style[side] = `${position[side]}px`;
    }
  };

  return {
    insertHTMLWebView: (args, { api, webviewId }) => {
      const doc = documentOf(webviewId);
      if (!doc) return fail(api, 'page not found');

      const htmlId = Number(args.htmlId);
      const frame = doc.createElement('iframe');
      frame.dataset.wxaHtmlId = String(htmlId);
      frame.style.cssText = 'position:fixed;z-index:2147483647;border:0;background:#fff';
      place(frame, args.position);
      frame.addEventListener('load', () => {
        const requested = frame.dataset.wxaLoading;
        if (requested) {
          delete frame.dataset.wxaLoading;
          reportFinish(webviewId, htmlId, requested);
          return;
        }
        // 网页里自己跳转的：同源时报告新地址；跨域读不到地址就不报，免得拿旧地址冒充
        const src = readableUrl(frame);
        if (!src || src === 'about:blank') return;
        reportStart(webviewId, htmlId, src);
        reportFinish(webviewId, htmlId, src);
      });
      doc.body.appendChild(frame);
      return ok(api);
    },

    updateHTMLWebView: (args, { api, webviewId }) => {
      const frame = find(webviewId, args.htmlId);
      if (!frame) return fail(api, 'web-view not found');
      place(frame, args.position);
      if (args.src) {
        const src = String(args.src);
        frame.dataset.wxaLoading = src;
        reportStart(webviewId, Number(args.htmlId), src);
        frame.src = src;
      }
      return ok(api);
    },

    removeHTMLWebView: (args, { api, webviewId }) => {
      find(webviewId, args.htmlId)?.remove();
      return ok(api);
    }
  };
}

function readableUrl(frame: HTMLIFrameElement): string | null {
  try {
    return frame.contentWindow?.location.href ?? null;
  } catch {
    return null;
  }
}
