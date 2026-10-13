import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleProxy } from '../../packages/core/src/server/proxy';

let upstream: http.Server;
let proxy: http.Server;
let upstreamUrl = '';
let proxyUrl = '';

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      res.setHeader('Set-Cookie', ['sid=abc; Path=/', 'theme=dark']);
      res.setHeader('X-Upstream', 'v=1; "quoted", list');
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = req.url === '/missing' ? 404 : 200;
      res.end(JSON.stringify({ method: req.method, cookie: req.headers.cookie, custom: req.headers['x-custom'], body }));
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const app = express();
  app.all('/proxy', express.raw({ type: () => true }), handleProxy);
  proxy = app.listen(0, '127.0.0.1');
  await new Promise(resolve => proxy.once('listening', resolve));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/proxy`;
});

afterAll(() => {
  upstream.close();
  proxy.close();
});

describe('网络代理', () => {
  it('转发方法、请求体和浏览器无法直接设置的请求头', async () => {
    const res = await fetch(`${proxyUrl}?url=${encodeURIComponent(upstreamUrl + '/echo')}`, {
      method: 'POST',
      headers: { 'x-wxa-headers': JSON.stringify({ cookie: 'token=1', 'X-Custom': 'yes' }) },
      body: 'payload'
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: 'POST', cookie: 'token=1', custom: 'yes', body: 'payload' });
  });

  it('响应头和 set-cookie 以编码后的 JSON 返回给浏览器', async () => {
    const res = await fetch(`${proxyUrl}?url=${encodeURIComponent(upstreamUrl)}`);
    const headers = JSON.parse(decodeURIComponent(res.headers.get('x-wxa-headers')!));
    expect(headers['x-upstream']).toBe('v=1; "quoted", list');
    expect(JSON.parse(decodeURIComponent(res.headers.get('x-wxa-set-cookie')!))).toEqual(['sid=abc; Path=/', 'theme=dark']);
  });

  it('保留上游的状态码', async () => {
    const res = await fetch(`${proxyUrl}?url=${encodeURIComponent(upstreamUrl + '/missing')}`);
    expect(res.status).toBe(404);
  });

  it('非法地址和连接失败时标记为代理错误', async () => {
    const invalid = await fetch(`${proxyUrl}?url=ftp://x`);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('x-wxa-proxy-error')).toBe('1');

    const unreachable = await fetch(`${proxyUrl}?url=${encodeURIComponent('http://127.0.0.1:1/')}`);
    expect(unreachable.status).toBe(502);
    expect(unreachable.headers.get('x-wxa-proxy-error')).toBe('1');
  });
});
