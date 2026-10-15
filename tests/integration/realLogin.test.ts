/**
 * 真实登录接口：开发服务器带着开发者 ticket 向微信换取 code 和手机号
 *
 * 微信服务器用 fetch 桩代替，响应格式取自对微信服务器的实测；
 * 访问本地接口用 http.request，才能自定义 Host 头。
 */

import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeveloperTicket, TICKET_ENV } from '../../packages/extractor/src/devtools';
import { realLoginRouter } from '../../packages/core/src/server/realLogin';
import { collectSetupEnv } from '../../packages/core/src/server/setup';

const LATER = Date.now() + 3600_000;
const PHONE_DATA = JSON.stringify({ data: '{"mobile":"138****1997"}', encryptedData: 'nW3E', iv: 'A44H', code: 'bb2730' });

let server: http.Server;
let port = 0;
let ticket: DeveloperTicket | null = null;

beforeAll(async () => {
  const app = express();
  app.use('/__wxa__/api', realLoginRouter('wx-app', () => ticket));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  ticket = null;
});

function post(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: `/__wxa__/api${path}`, method: 'POST', headers }, res => {
      let text = '';
      res.on('data', chunk => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 把对微信服务器的请求换成固定响应 */
function stubWechat(body: object) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('真实登录接口', () => {
  it('wx.login：用开发者 ticket 请求 jslogin，返回微信签发的 code', async () => {
    ticket = { newticket: 'a+b&c=d', expiredAt: LATER };
    const fetchMock = stubWechat({ baseresponse: { errcode: 0, errmsg: 'ok' }, code: '0e3LEm' });

    expect(await post('/login')).toEqual({ status: 200, body: { code: '0e3LEm' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { pathname, searchParams } = new URL(url);
    expect(pathname).toBe('/wxa-dev-logic/jslogin');
    // ticket 里的 + & = 要编码，否则微信收到的是被截断的 ticket
    expect(searchParams.get('newticket')).toBe('a+b&c=d');
    expect(searchParams.get('appid')).toBe('wx-app');
    expect(JSON.parse(init.body as string)).toEqual({ scope: ['snsapi_base'] });
  });

  it('手机号：按 jsgetuserwxphone 的响应格式解析，data 原样转交给基础库', async () => {
    ticket = { newticket: 't', expiredAt: LATER };
    stubWechat({ BaseResponse: { Ret: 0, ErrMsg: { String: '' } }, jsapi_baseresponse: { errcode: 0 }, data: PHONE_DATA });

    const { status, body } = await post('/phone-number');
    expect(status).toBe(200);
    expect(body).toEqual({ data: PHONE_DATA, encryptedData: 'nW3E', iv: 'A44H' });
    expect(JSON.parse(body.data).code).toBe('bb2730');
  });

  it('微信返回错误码时说明原因和处理办法', async () => {
    ticket = { newticket: 't', expiredAt: LATER };
    stubWechat({ baseresponse: { errcode: 40029, errmsg: 'invalid ticket' } });

    const { status, body } = await post('/login');
    expect(status).toBe(500);
    expect(body.error).toBe('微信登录失败 40029: invalid ticket（登录态已失效，请在微信开发者工具里重新登录）');
  });

  it('连不上微信服务器时报出具体原因', async () => {
    ticket = { newticket: 't', expiredAt: LATER };
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND servicewechat.com') });
    });

    expect((await post('/login')).body.error).toBe('请求微信服务器失败：getaddrinfo ENOTFOUND servicewechat.com');
  });

  it('没有登录态、登录态过期时提示处理办法，不请求微信', async () => {
    const fetchMock = stubWechat({});

    expect((await post('/login')).body.error).toContain(`未找到微信开发者工具的登录态，请登录开发者工具，或设置环境变量 ${TICKET_ENV}`);
    ticket = { newticket: 't', expiredAt: Date.now() - 1000 };
    expect((await post('/phone-number')).body.error).toBe('微信开发者工具的登录态已过期，请打开开发者工具刷新登录态');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('每次请求重新读取登录态：开发者工具刷新登录后不用重启服务器', async () => {
    stubWechat({ baseresponse: { errcode: 0 }, code: 'fresh' });
    ticket = { newticket: 'old', expiredAt: Date.now() - 1000 };
    expect((await post('/login')).status).toBe(500);

    ticket = { newticket: 'new', expiredAt: LATER };
    expect(await post('/login')).toEqual({ status: 200, body: { code: 'fresh' } });
  });

  it('只允许经本机地址访问：防 DNS rebinding，IPv6 的 [::1] 可以访问', async () => {
    ticket = { newticket: 't', expiredAt: LATER };
    const fetchMock = stubWechat({ baseresponse: { errcode: 0 }, code: 'c' });

    expect(await post('/login', { host: `evil.example:${port}` })).toEqual({ status: 403, body: { error: '真实登录接口只允许本机访问' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await post('/login', { host: `[::1]:${port}` })).status).toBe(200);
    expect((await post('/login', { host: `localhost:${port}` })).status).toBe(200);
  });

  it('开发者 ticket 的环境变量不会随 setup 下发给浏览器', () => {
    expect(collectSetupEnv({ [TICKET_ENV]: 'secret', WXA_NAME: 'dev' })).toEqual({ WXA_NAME: 'dev' });
  });
});
