/**
 * 定位 wcc / wcsc 可执行文件
 *
 * 使用开发者工具自带的命令行版本（node_modules/wcc-exec），而不是 wcc.node 原生模块：
 * 原生模块在 Node 进程里重复调用会随机触发 std::bad_alloc 崩溃，
 * 子进程方式则天然隔离，单次编译只需几毫秒。
 *
 * 没有开发者工具时（如 Linux、CI），用微信官方 npm 包 miniprogram-compiler 自带的编译器。
 * 它的编译内核较旧（20200413，开发者工具为 20211229）：页面的编译结果相同，
 * 只有模板运行时有少量差异，如旧版限制单页最多 16000 个节点。
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
  if (!cached) cached = locateCompilerBinaries(findDevtoolsPackageDirs());
  return cached;
}

/**
 * 依次查找：环境变量 WXA_WCC + WXA_WCSC、开发者工具、miniprogram-compiler
 *
 * @throws 都找不到时
 */
export function locateCompilerBinaries(devtoolsDirs: string[]): CompilerBinaries {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates: CompilerBinaries[] = [];

  if (process.env.WXA_WCC && process.env.WXA_WCSC) {
    candidates.push({ wcc: process.env.WXA_WCC, wcsc: process.env.WXA_WCSC });
  }
  for (const dir of devtoolsDirs) {
    const execDir = path.join(dir, 'node_modules', 'wcc-exec');
    candidates.push({ wcc: path.join(execDir, 'wcc' + ext), wcsc: path.join(execDir, 'wcsc' + ext) });
  }
  const packaged = findPackagedCompiler(ext);
  if (packaged) candidates.push(packaged);

  const found = candidates.find(c => fs.existsSync(c.wcc) && fs.existsSync(c.wcsc));
  if (!found) {
    throw new Error(
      '没有找到 wcc/wcsc 编译器。请安装微信开发者工具，或重新安装依赖以安装 miniprogram-compiler（Linux 只支持 x86-64），' +
      '或通过 WXA_DEVTOOLS_PATH / WXA_WCC + WXA_WCSC 指定位置。'
    );
  }
  // npm 包里的 Linux 版没有可执行权限
  if (found === packaged) {
    for (const file of [found.wcc, found.wcsc]) {
      try {
        fs.accessSync(file, fs.constants.X_OK);
      } catch {
        fs.chmodSync(file, 0o755);
      }
    }
  }
  return found;
}

/** miniprogram-compiler 里当前平台的编译器；它是可选依赖，没装上或平台不支持时返回 null */
function findPackagedCompiler(ext: string): CompilerBinaries | null {
  const platformDir =
    process.platform === 'darwin' ? 'mac'
    : process.platform === 'win32' ? 'windows'
    : process.platform === 'linux' && process.arch === 'x64' ? 'linux'
    : null;
  if (!platformDir) return null;

  let root: string;
  try {
    root = path.dirname(require.resolve('miniprogram-compiler/package.json'));
  } catch {
    return null;
  }
  const dir = path.join(root, 'bin', platformDir);
  return { wcc: path.join(dir, 'wcc' + ext), wcsc: path.join(dir, 'wcsc' + ext) };
}
