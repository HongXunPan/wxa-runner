/**
 * 定位 wcc / wcsc 可执行文件
 *
 * 使用开发者工具自带的命令行版本（node_modules/wcc-exec），而不是 wcc.node 原生模块：
 * 原生模块在 Node 进程里重复调用会随机触发 std::bad_alloc 崩溃，
 * 子进程方式则天然隔离，单次编译只需几毫秒。
 */

import fs from 'fs';
import path from 'path';
import { findDevtoolsPackageDirs } from '@open-wxa/wxa-runner-extractor';

export interface CompilerBinaries {
  wcc: string;
  wcsc: string;
}

let cached: CompilerBinaries | null = null;

export function findCompilerBinaries(): CompilerBinaries {
  if (cached) return cached;

  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates: CompilerBinaries[] = [];

  if (process.env.WXA_WCC && process.env.WXA_WCSC) {
    candidates.push({ wcc: process.env.WXA_WCC, wcsc: process.env.WXA_WCSC });
  }
  for (const dir of findDevtoolsPackageDirs()) {
    const execDir = path.join(dir, 'node_modules', 'wcc-exec');
    candidates.push({ wcc: path.join(execDir, 'wcc' + ext), wcsc: path.join(execDir, 'wcsc' + ext) });
  }

  const found = candidates.find(c => fs.existsSync(c.wcc) && fs.existsSync(c.wcsc));
  if (!found) {
    throw new Error(
      '没有找到 wcc/wcsc 编译器。请安装微信开发者工具，或通过 WXA_DEVTOOLS_PATH / WXA_WCC + WXA_WCSC 指定位置。'
    );
  }
  cached = found;
  return found;
}
