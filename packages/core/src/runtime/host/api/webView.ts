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
  const views = new Map<number, { frame: HTMLIFrameElement; webviewId: number }>();

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
      // 页面关闭时基础库不一定调 removeHTMLWebView，跟着页面消失的网页在这里清掉
      for (const [id, view] of views) if (!view.frame.isConnected) views.delete(id);

      const htmlId = Number(args.htmlId);
      const frame = doc.createElement('iframe');
      frame.style.cssText = 'position:fixed;z-index:2147483647;border:0;background:#fff';
      place(frame, args.position);
      frame.addEventListener('load', () => {
        // 插入时先加载的 about:blank 不算
        if (frame.dataset.src) emitToWebview(webviewId, 'onWebviewFinishLoad', { htmlId, src: frame.dataset.src });
      });
      doc.body.appendChild(frame);
      views.set(htmlId, { frame, webviewId });
      return ok(api);
    },

    updateHTMLWebView: (args, { api }) => {
      const htmlId = Number(args.htmlId);
      const view = views.get(htmlId);
      if (!view) return fail(api, 'web-view not found');
      place(view.frame, args.position);
      if (args.src) {
        const src = String(args.src);
        view.frame.dataset.src = src;
        emitToWebview(view.webviewId, 'onWebviewStartLoad', { htmlId, src, isMainFrame: true });
        view.frame.src = src;
      }
      return ok(api);
    },

    removeHTMLWebView: (args, { api }) => {
      const htmlId = Number(args.htmlId);
      views.get(htmlId)?.frame.remove();
      views.delete(htmlId);
      return ok(api);
    }
  };
}
