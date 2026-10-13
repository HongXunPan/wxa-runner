/**
 * WXSS 编译（wcsc）
 *
 * 输出是 "key=value=key=value" 交替的字符串，value 是转义过的 JS 源码：
 *   comm            公共运行时（setCssToHead、rpx 换算）以及非页面样式（app.wxss 等）的立即执行代码
 *   ./pages/a.wxss  每个页面/组件一个 setCssToHead(...)，返回的函数在页面创建时调用
 */

import { runCompiler } from './exec';
import { findCompilerBinaries } from './locate';

export interface WxssCompileOptions {
  cwd: string;
  /** 页面和组件的 wxss，./ 开头 */
  pageFiles: string[];
  /** 其余样式（app.wxss），以公共样式形式写入 comm */
  commonFiles: string[];
}

export interface WxssCompileResult {
  comm: string;
  /** 键为不带 ./ 的路径，如 "pages/index/index.wxss" */
  pages: Record<string, string>;
}

export async function compileWxss(options: WxssCompileOptions): Promise<WxssCompileResult> {
  const { wcsc } = findCompilerBinaries();
  const files = [...options.pageFiles, ...options.commonFiles];
  if (files.length === 0) {
    return { comm: '', pages: {} };
  }

  const args = ['-db', '-pc', String(options.pageFiles.length), ...files];
  const raw = parseWcscOutput(await runCompiler(wcsc, args, options.cwd));

  const pages: Record<string, string> = {};
  for (const file of options.pageFiles) {
    if (raw[file] !== undefined) pages[file.replace(/^\.\//, '')] = raw[file];
  }
  return { comm: raw.comm || '', pages };
}

export function parseWcscOutput(output: string): Record<string, string> {
  const parts = output.split('=');
  const result: Record<string, string> = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    result[parts[i]] = unescapeJsString(parts[i + 1]);
  }
  return result;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0'
};

export function unescapeJsString(value: string): string {
  return value.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, seq: string) => {
    if ((seq[0] === 'x' || seq[0] === 'u') && seq.length > 1) {
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    return SIMPLE_ESCAPES[seq] ?? seq;
  });
}
