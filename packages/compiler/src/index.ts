/**
 * wxa-runner-compiler：官方 wcc / wcsc 编译器封装
 */

export { compileWxml } from './wcc';
export type { ComponentTags, WxmlCompileOptions } from './wcc';
export { compileWxss, parseWcscOutput, unescapeJsString } from './wcsc';
export type { WxssCompileOptions, WxssCompileResult } from './wcsc';
export { findCompilerBinaries } from './locate';
export type { CompilerBinaries } from './locate';
