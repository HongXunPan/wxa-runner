import type { MockRequest, RecordedRequest } from '@open-wxa/wxa-runner-core';

/** 小程序发出的一个 wx.request */
export interface MiniProgramRequest extends RecordedRequest {
  /** 按 Content-Type 解析后的请求体：JSON 解析成对象，表单解析成 { 字段: 值 }，解析不了时同 data */
  body: any;
}

/** 按 Content-Type 解析基础库序列化后的请求体，解析不了时原样返回 data */
export function parseRequestBody(request: Pick<MockRequest, 'header' | 'data'>): unknown {
  const { data } = request;
  if (typeof data !== 'string') return data;

  const type = Object.entries(request.header).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '';
  if (/\/x-www-form-urlencoded/i.test(type)) return Object.fromEntries(new URLSearchParams(data));
  if (/[/+]json/i.test(type)) {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

export function withBody(request: RecordedRequest): MiniProgramRequest {
  return { ...request, body: parseRequestBody(request) };
}
