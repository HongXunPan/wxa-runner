/**
 * setup：小程序启动前准备运行环境（@open-wxa/wxa-runner-core/setup）
 *
 * 浏览器里拿不到真实的登录 code、用户信息、定位等，setup 在 App.onLaunch 之前
 * 预置存储、覆盖原生 API，让小程序直接进入「已登录」之类的状态。
 *
 *   // wxa.setup.ts（放在项目根目录自动生效，或用 --setup 指定）
 *   import { defineSetup } from '@open-wxa/wxa-runner-core/setup';
 *
 *   export default defineSetup(({ env }) => ({
 *     storage: { token: env.WXA_TOKEN },
 *     mock: { login: { code: 'dev_code' } }
 *   }));
 *
 * 执行顺序固定为 storage → mock → run，每次打开或刷新页面都会重新执行。
 */

import type { ApiResult } from './runtime/host/api/registry';

/** 启动命令所在环境中以 WXA_ 开头的环境变量 */
export type SetupEnv = Record<string, string | undefined>;

export interface SetupContext {
  env: SetupEnv;
}

/**
 * 原生 API 的替身：对象直接作为调用结果；函数按调用参数返回结果，抛错即调用失败（errMsg 为 `<api>:fail <message>`）
 */
export type MockValue<T extends ApiResult = ApiResult> = T | ((args: any) => T | void | Promise<T | void>);

export interface UserInfo {
  nickName: string;
  avatarUrl: string;
  gender: 0 | 1 | 2;
  country: string;
  province: string;
  city: string;
  language: string;
}

/** 常用 API 的返回值提示；其他 API 也可以按名字覆盖 */
export interface KnownMocks {
  /** 业务后端通常要把 code 换成 token，可配合测试环境后端约定的固定 code */
  login: MockValue<{ code: string }>;
  checkSession: MockValue<{}>;
  getUserProfile: MockValue<{ userInfo: Partial<UserInfo>; encryptedData?: string; iv?: string }>;
  getUserInfo: MockValue<{ userInfo: Partial<UserInfo>; encryptedData?: string; iv?: string }>;
  getSetting: MockValue<{ authSetting: Record<string, boolean> }>;
  authorize: MockValue<{}>;
  getLocation: MockValue<{ latitude: number; longitude: number; speed?: number; accuracy?: number }>;
  chooseLocation: MockValue<{ name: string; address: string; latitude: number; longitude: number }>;
  scanCode: MockValue<{ result: string; scanType?: string; charSet?: string; path?: string }>;
  requestPayment: MockValue<{}>;
  requestSubscribeMessage: MockValue<Record<string, string>>;
}

export type MockConfig = Partial<KnownMocks> & Record<string, MockValue>;

export interface SetupConfig {
  /** 预置到 wx.setStorage 的数据，值保持原类型（对象、数字、Date 等），覆盖同名旧值 */
  storage?: Record<string, unknown>;
  /** 按 wx API 名覆盖原生实现，如 login、getLocation */
  mock?: MockConfig;
  /** 声明式配置之后执行，适合异步或动态逻辑（如现场向测试后端换一个新 token） */
  run?(wxa: SetupApi): void | Promise<void>;
}

export type SetupDefinition = SetupConfig | ((context: SetupContext) => SetupConfig | Promise<SetupConfig>);

/** run 里可用的能力，与声明式配置一一对应 */
export interface SetupApi {
  env: SetupEnv;
  storage: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
    /** 清空小程序的业务存储 */
    clear(): void;
  };
  mock<K extends string>(api: K, impl: K extends keyof KnownMocks ? NonNullable<KnownMocks[K]> : MockValue): void;
  /** 经开发服务器代理发请求，没有跨域限制 */
  fetch(url: string, init?: { method?: string; header?: Record<string, string>; body?: string }): Promise<Response>;
}

/** 只用于获得类型提示，原样返回传入的配置 */
export function defineSetup<T extends SetupDefinition>(setup: T): T {
  return setup;
}
