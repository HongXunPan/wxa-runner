/**
 * Playwright fixture 记录的请求：按 Content-Type 解析基础库序列化后的请求体
 */

import { describe, expect, it } from 'vitest';
import { parseRequestBody } from '../../packages/playwright/src/request';

const request = (header: Record<string, string>, data: unknown) => ({ url: 'https://api.example.com/x', method: 'POST', header, data });

describe('请求体', () => {
  it('JSON 请求体解析成对象', () => {
    expect(parseRequestBody(request({ 'content-type': 'application/json' }, '{"sku":"A1","count":2}'))).toEqual({ sku: 'A1', count: 2 });
  });

  it('表单请求体按字段解析，Content-Type 不区分大小写', () => {
    expect(parseRequestBody(request({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, 'a=1&b=x%20y')))
      .toEqual({ a: '1', b: 'x y' });
  });

  it('声明为 JSON 但不是合法 JSON 的文本原样返回', () => {
    expect(parseRequestBody(request({ 'content-type': 'application/json' }, 'raw text'))).toBe('raw text');
  });

  it('其他类型的请求体原样返回', () => {
    expect(parseRequestBody(request({ 'content-type': 'text/plain' }, '{"a":1}'))).toBe('{"a":1}');
    expect(parseRequestBody(request({}, undefined))).toBeUndefined();
  });
});
