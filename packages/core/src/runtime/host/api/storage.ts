/**
 * Storage：落到浏览器 localStorage，按 appid 和 storageId 隔离
 *
 * 基础库传来的 data 已经序列化成字符串，并附带 dataType（"Number"、"Object" 等），
 * 读取时原样交回，由基础库反序列化。storageId 0 是业务数据，其他值是基础库内部缓存。
 */

import { ApiHandler, fail, ok } from './registry';

/** 只用到 localStorage 的这几个方法，便于测试时替换 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

const LIMIT_SIZE_KB = 10 * 1024;

export class MiniProgramStorage {
  constructor(private readonly store: KeyValueStore, private readonly appid: string) {}

  set(namespace: string, key: string, data: unknown, dataType?: string) {
    this.store.setItem(this.prefix(namespace) + key, JSON.stringify([data, dataType]));
  }

  get(namespace: string, key: string): { data: unknown; dataType?: string } | null {
    const raw = this.store.getItem(this.prefix(namespace) + key);
    if (raw === null) return null;
    const [data, dataType] = JSON.parse(raw);
    return { data, dataType };
  }

  remove(namespace: string, key: string) {
    this.store.removeItem(this.prefix(namespace) + key);
  }

  keys(namespace: string): string[] {
    const prefix = this.prefix(namespace);
    const keys: string[] = [];
    for (let i = 0; i < this.store.length; i++) {
      const key = this.store.key(i);
      if (key && key.startsWith(prefix)) keys.push(key.slice(prefix.length));
    }
    return keys;
  }

  clear(namespace: string) {
    for (const key of this.keys(namespace)) this.remove(namespace, key);
  }

  info(namespace: string) {
    const prefix = this.prefix(namespace);
    const keys = this.keys(namespace);
    let bytes = 0;
    for (const key of keys) {
      bytes += (key.length + (this.store.getItem(prefix + key) || '').length) * 2;
    }
    return { keys, currentSize: Math.ceil(bytes / 1024), limitSize: LIMIT_SIZE_KB };
  }

  private prefix(namespace: string) {
    return `wxa:${this.appid}:${namespace}:`;
  }
}

export function createStorageApis(storage: MiniProgramStorage): Record<string, ApiHandler> {
  const ns = (args: any) => `s${args.storageId || 0}`;

  const get: ApiHandler = (args, { api }) => {
    const item = storage.get(ns(args), args.key);
    return item ? ok(api, item) : fail(api, 'data not found');
  };
  const set: ApiHandler = args => storage.set(ns(args), args.key, args.data, args.dataType);
  const remove: ApiHandler = args => storage.remove(ns(args), args.key);
  const clear: ApiHandler = args => storage.clear(ns(args));
  const info: ApiHandler = args => storage.info(ns(args));

  // 渲染层用 global storage 存 cookie 等信息
  const globalGet: ApiHandler = (args, { api }) => {
    const item = storage.get('global', args.key);
    return item ? ok(api, { data: item.data }) : fail(api, 'data not found');
  };

  return {
    getStorage: get,
    getStorageSync: get,
    setStorage: set,
    setStorageSync: set,
    removeStorage: remove,
    removeStorageSync: remove,
    clearStorage: clear,
    clearStorageSync: clear,
    getStorageInfo: info,
    getStorageInfoSync: info,
    getGlobalStorage: globalGet,
    getGlobalStorageSync: globalGet,
    setGlobalStorage: args => storage.set('global', args.key, args.data),
    setGlobalStorageSync: args => storage.set('global', args.key, args.data),
    removeGlobalStorage: args => storage.remove('global', args.key),
    clearGlobalStorage: () => storage.clear('global'),
    getGlobalStorageInfo: () => storage.info('global')
  };
}
