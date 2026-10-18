/**
 * 端到端：业务代码收发二进制数据（wx.request 的 arraybuffer、WebSocket 的二进制消息）
 *
 * 收到的 ArrayBuffer 要属于业务代码自己的全局环境，instanceof 才成立；字节要和服务器发的一致，不能按文本解码。
 * 字节里有 0x80、0xff 这类不是合法 UTF-8 的值，按文本解码过就会变。
 */

import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { e2eReady, Runner, startRunner } from './runner';

const SERVER_BYTES = [0, 1, 0x7f, 0x80, 0xff];
const APP_BYTES = [0, 0x80, 0xff];

// 收到的数据写成「是不是 ArrayBuffer 字节列表」，在业务代码里判断
const PAGE_JS = `
const describe = data => (data instanceof ArrayBuffer) + ' ' + Array.from(new Uint8Array(data)).join(',');
Page({
  download(url) {
    return new Promise(resolve => wx.request({
      url,
      responseType: 'arraybuffer',
      success: res => resolve(describe(res.data)),
      fail: err => resolve(err.errMsg)
    }));
  },
  upload(url) {
    return new Promise(resolve => wx.request({
      url,
      method: 'POST',
      header: { 'content-type': 'application/octet-stream' },
      data: new Uint8Array([${APP_BYTES}]).buffer,
      success: res => resolve(res.statusCode),
      fail: err => resolve(err.errMsg)
    }));
  },
  // 连上后发一条二进制消息，返回收到的第一条消息
  chat(url) {
    return new Promise(resolve => {
      const task = wx.connectSocket({ url });
      task.onOpen(() => task.send({ data: new Uint8Array([${APP_BYTES}]).buffer }));
      task.onMessage(({ data }) => {
        resolve(describe(data));
        task.close({});
      });
      task.onError(err => resolve(err.errMsg));
    });
  }
});
`;

describe.skipIf(!e2eReady)('业务代码收发二进制数据', () => {
  let runner: Runner;
  let server: http.Server;
  let serverUrl = '';
  let sockets: WebSocketServer;
  let socketUrl = '';
  /** 服务器收到的请求体和 WebSocket 消息 */
  const received: number[][] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        received.push([...Buffer.concat(chunks)]);
        res.setHeader('content-type', 'application/octet-stream');
        res.end(Buffer.from(SERVER_BYTES));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // 收到业务发来的消息后回一条二进制消息
    sockets = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => sockets.on('listening', resolve));
    sockets.on('connection', socket => socket.on('message', data => {
      received.push([...(data as Buffer)]);
      socket.send(Buffer.from(SERVER_BYTES));
    }));
    socketUrl = `ws://127.0.0.1:${(sockets.address() as AddressInfo).port}`;

    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view>binary</view>',
      'pages/index/index.js': PAGE_JS
    });
  });

  afterAll(async () => {
    await runner?.close();
    server?.close();
    sockets?.close();
  });

  const callPage = (method: string, url: string) =>
    runner.page.evaluate(([m, u]) => window.__wxa_test_api__.callPageMethod(m, u), [method, url] as const);

  it('业务按 responseType: arraybuffer 请求时，拿到 ArrayBuffer，字节与服务器返回的一致', async () => {
    await runner.open('/?path=pages/index/index');
    expect(await callPage('download', `${serverUrl}/avatar.png`)).toBe(`true ${SERVER_BYTES}`);
  });

  it('业务以 ArrayBuffer 作为请求体发出请求，服务器收到的字节一致', async () => {
    await runner.open('/?path=pages/index/index');
    received.length = 0;
    expect(await callPage('upload', `${serverUrl}/upload`)).toBe(200);
    expect(received).toEqual([APP_BYTES]);
  });

  it('测试拦截请求并返回 ArrayBuffer 时，业务拿到同样的字节', async () => {
    const { page } = runner;
    await runner.open('/?path=pages/index/index');
    await page.evaluate(() => window.__wxa_test_api__.route('**/api/avatar', { body: new Uint8Array([0x89, 0x50, 0xff]).buffer }));
    expect(await callPage('download', 'https://api.example.com/api/avatar')).toBe('true 137,80,255');
  });

  it('业务通过 WebSocket 发出二进制消息，服务器收到的字节一致；服务器回的二进制消息业务拿到 ArrayBuffer', async () => {
    await runner.open('/?path=pages/index/index');
    received.length = 0;
    expect(await callPage('chat', socketUrl)).toBe(`true ${SERVER_BYTES}`);
    expect(received).toEqual([APP_BYTES]);
  });
});
