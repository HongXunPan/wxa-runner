/**
 * window.__wxa_test_api__ 的全局类型声明，供测试代码按需引用：
 *
 *   /// <reference types="@open-wxa/wxa-runner-core/test-api" />
 *
 * 只产出类型，不参与运行时打包。WxaTestApi 等类型从包的主入口导入。
 */

import type { WxaTestApi } from './runtime/host/testApi';

declare global {
  interface Window {
    __wxa_test_api__: WxaTestApi;
  }
}

export {};
