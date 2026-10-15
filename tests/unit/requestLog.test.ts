/**
 * 宿主记录的 wx.request：平时调试不跑测试时也在记录，数量要有上限
 */

import { describe, expect, it } from 'vitest';
import { RequestLog } from '../../packages/core/src/runtime/host/api/network';

const request = (i: number) => ({ url: `https://api.example.com/${i}`, method: 'GET', header: {}, data: '', routedBy: null });

describe('请求记录', () => {
  it('只保留最近的 1000 个请求，长时间调试时内存不会一直增长', () => {
    const log = new RequestLog();
    for (let i = 0; i < 1005; i++) log.add(request(i));

    const urls = log.list().map(r => r.url);
    expect(urls).toHaveLength(1000);
    expect(urls[0]).toBe('https://api.example.com/5');
    expect(urls[999]).toBe('https://api.example.com/1004');
  });

  it('清空后从头记录，读到的是副本', () => {
    const log = new RequestLog();
    log.add(request(1));
    log.list()[0].header.injected = 'x';
    expect(log.list()[0].header).toEqual({});

    log.clear();
    expect(log.list()).toEqual([]);
  });
});
