/**
 * 请求拦截：setup 的 network.routes 声明的接口不发往网络，直接返回给定的响应
 *
 * 规则写法：'[METHOD ]URL'，如 'POST https://api.example.com/login'。URL 里 * 匹配一段路径，
 * ** 匹配任意内容（可以不写域名，按路径匹配）；查询参数和 hash 不参与匹配。
 */

import type { MockRequest, MockResponse, RouteHandler } from '../../../setup';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'];

interface Route {
  pattern: string;
  method: string | null;
  url: RegExp;
  handler: RouteHandler;
}

export class RequestRoutes {
  private routes: Route[] = [];

  /**
   * 后添加的规则优先
   * @throws 规则写法不对时
   */
  add(pattern: string, handler: RouteHandler) {
    const parts = pattern.trim().split(/\s+/);
    if (parts.length > 2 || (parts.length === 2 && !METHODS.includes(parts[0].toUpperCase()))) {
      throw new Error(`拦截规则应写成 "[请求方法 ]地址"，如 "POST https://api.example.com/login"、"**/auth/login"`);
    }
    if (typeof handler !== 'function' && (handler === null || typeof handler !== 'object')) {
      throw new Error('拦截规则的值需要是响应对象 { status?, header?, body? }，或按请求返回响应的函数');
    }
    const [method, url] = parts.length === 2 ? [parts[0].toUpperCase(), parts[1]] : [null, parts[0]];
    this.routes.unshift({ pattern, method, url: globToRegExp(url), handler });
  }

  /** 找到匹配的规则时返回它的响应，否则返回 undefined */
  async respond(request: MockRequest): Promise<{ statusCode: number; header: Record<string, string>; data: string } | undefined> {
    const url = request.url.replace(/[?#].*$/, '');
    const route = this.routes.find(r => (!r.method || r.method === request.method) && r.url.test(url));
    if (!route) return undefined;

    console.info(`[wxa-runner] 拦截请求 ${request.method} ${request.url}（${route.pattern}）`);
    const response: MockResponse = typeof route.handler === 'function' ? (await route.handler(request)) || {} : route.handler;
    const { body } = response;
    const isText = typeof body === 'string' || body === undefined;
    return {
      statusCode: response.status ?? 200,
      header: { ...(isText ? {} : { 'Content-Type': 'application/json' }), ...response.header },
      data: body === undefined ? '' : isText ? (body as string) : JSON.stringify(body)
    };
  }
}

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('**')
    .map(part => part.split('*').map(escapeRegExp).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
