/**
 * 启动前环境准备（setup）：预置存储、覆盖原生 API、run 兜底
 *
 * 断言都落在小程序可观测的结果上：基础库经 invoke 读到的存储、原生 API 的返回值。
 */

import { describe, expect, it } from 'vitest';
import { ApiRegistry } from '../../packages/core/src/runtime/host/api/registry';
import {
  createStorageApis,
  decodeStorageValue,
  KeyValueStore,
  MiniProgramStorage
} from '../../packages/core/src/runtime/host/api/storage';
import { applySetup, formatSetupSummary } from '../../packages/core/src/runtime/host/setup';
import { defineSetup } from '../../packages/core/src/setup';

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: key => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    key: index => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    }
  };
}

function createTarget() {
  const storage = new MiniProgramStorage(memoryStore(), 'wxtest');
  const api = new ApiRegistry();
  api.register(createStorageApis(storage));
  const invoke = (name: string, args: object = {}) => api.invoke(name, args, { api: name, from: 'service', webviewId: 1 });
  /** 小程序里 wx.getStorageSync(key) 拿到的值：基础库按 dataType 还原 invoke 结果 */
  const readStorage = (key: string) => {
    const result = invoke('getStorageSync', { key }) as any;
    return result.errMsg.endsWith(':ok') ? decodeStorageValue(result) : undefined;
  };
  return { target: { storage, api }, invoke, readStorage };
}

describe('setup 预置存储', () => {
  it('小程序读到的存储值保持原本的类型', async () => {
    const { target, readStorage } = createTarget();
    const loginAt = new Date('2026-01-01T00:00:00Z');

    await applySetup(defineSetup({
      storage: { token: 'abc', userInfo: { id: 1, tags: ['a'] }, count: 3, vip: false, loginAt, empty: null }
    }), target, {});

    expect(readStorage('token')).toBe('abc');
    expect(readStorage('userInfo')).toEqual({ id: 1, tags: ['a'] });
    expect(readStorage('count')).toBe(3);
    expect(readStorage('vip')).toBe(false);
    expect(readStorage('loginAt')).toEqual(loginAt);
    expect(readStorage('empty')).toBeNull();
  });

  it('预置值覆盖同名旧值，其他已有数据保留', async () => {
    const { target, invoke, readStorage } = createTarget();
    invoke('setStorageSync', { key: 'token', data: 'expired', dataType: 'String' });
    invoke('setStorageSync', { key: 'cart', data: '[1]', dataType: 'Array' });

    await applySetup({ storage: { token: 'fresh' } }, target, {});

    expect(readStorage('token')).toBe('fresh');
    expect(readStorage('cart')).toEqual([1]);
  });

  it('存储值是函数等无法序列化的类型时报错并指出 key', async () => {
    const { target } = createTarget();
    await expect(applySetup({ storage: { token: () => 'x' } as any }, target, {})).rejects.toThrow(/storage\.token/);
  });
});

describe('setup 覆盖原生 API', () => {
  it('wx.login 返回 setup 里给定的 code', async () => {
    const { target, invoke } = createTarget();
    await applySetup({ mock: { login: { code: 'dev_code' } } }, target, {});
    expect(invoke('login')).toEqual({ code: 'dev_code', errMsg: 'login:ok' });
  });

  it('函数形式的 mock 按调用参数返回，抛错即调用失败', async () => {
    const { target, invoke } = createTarget();
    await applySetup({
      mock: {
        getLocation: (args: any) => ({ latitude: args.type === 'gcj02' ? 31.23 : 0, longitude: 121.47 }),
        requestPayment: () => {
          throw new Error('余额不足');
        }
      }
    }, target, {});

    expect(invoke('getLocation', { type: 'gcj02' })).toMatchObject({ latitude: 31.23, errMsg: 'getLocation:ok' });
    expect(invoke('requestPayment')).toEqual({ errMsg: 'requestPayment:fail 余额不足' });
  });

  it('mock wx.request 这类经内部任务实现的 API 时报错，提示改用请求拦截', async () => {
    const { target } = createTarget();
    await expect(applySetup({ mock: { request: { data: {} } } }, target, {})).rejects.toThrow(/request.*请求拦截/);
  });

  it('mock 存储 API 时报错，提示改用 storage', async () => {
    const { target } = createTarget();
    await expect(applySetup({ mock: { getStorageSync: { data: 'x' } } }, target, {})).rejects.toThrow(/storage/);
  });
});

describe('setup 的写法', () => {
  it('函数形式的 setup 能拿到环境变量', async () => {
    const { target, readStorage } = createTarget();
    await applySetup(defineSetup(({ env }) => ({ storage: { token: env.WXA_TOKEN } })), target, { WXA_TOKEN: 't-123' });
    expect(readStorage('token')).toBe('t-123');
  });

  it('run 在声明式配置之后执行，异步完成后 setup 才算结束', async () => {
    const { target, invoke, readStorage } = createTarget();
    await applySetup({
      storage: { token: 'from-config' },
      mock: { login: { code: 'from-config' } },
      async run(wxa) {
        await new Promise(resolve => setTimeout(resolve, 10));
        wxa.storage.set('token', `${wxa.storage.get('token')}+run`);
        wxa.mock('login', { code: wxa.env.WXA_CODE });
      }
    }, target, { WXA_CODE: 'from-run' });

    expect(readStorage('token')).toBe('from-config+run');
    expect(invoke('login')).toMatchObject({ code: 'from-run' });
  });

  it('写错的配置项直接报错，并列出可用的配置项', async () => {
    const { target } = createTarget();
    await expect(applySetup({ storge: { token: 'x' } } as any, target, {})).rejects.toThrow(/storge.*storage, mock, run/);
  });

  it('setup 默认导出不是对象或函数时报错', async () => {
    const { target } = createTarget();
    await expect(applySetup(undefined, target, {})).rejects.toThrow(/export default/);
  });
});

describe('setup 执行摘要', () => {
  it('列出预置的存储 key 和覆盖的 API，包括 run 里做的', async () => {
    const { target } = createTarget();
    const summary = await applySetup({
      storage: { token: 'x', userInfo: {} },
      mock: { login: { code: 'c' } },
      run(wxa) {
        wxa.mock('getLocation', { latitude: 0, longitude: 0 });
      }
    }, target, {});

    const text = formatSetupSummary(summary);
    expect(text).toMatch(/storage\s+token, userInfo/);
    expect(text).toMatch(/mock\s+login, getLocation/);
  });
});
