/**
 * 基础库版本选择与提取
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { findVendorDirs } from './devtools';
import { readWxvpkgFile, readWxvpkgIndex } from './wxvpkg';

/**
 * 能在单个逻辑层上下文中运行的最高版本。
 * 3.7.1 起基础库默认把业务代码放进由原生 WeixinJSContext 创建的隔离上下文，
 * 运行时还没有模拟这一层。
 */
export const MAX_COMPATIBLE_VERSION = '3.7.0';

export const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.wxa-runner', 'baselib');

export interface InstalledBaseLib {
  version: string;
  file: string;
  compatible: boolean;
}

export interface ResolvedBaseLib {
  version: string;
  /** 解包后的目录，包含 WAService.js / WAWebview.js 等 */
  dir: string;
  compatible: boolean;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isCompatibleVersion(version: string): boolean {
  return compareVersions(version, MAX_COMPATIBLE_VERSION) <= 0;
}

/** 列出本机开发者工具下载过的所有基础库，版本从新到旧 */
export function listInstalledBaseLibs(vendorDirs = findVendorDirs()): InstalledBaseLib[] {
  const byVersion = new Map<string, InstalledBaseLib>();

  for (const dir of vendorDirs) {
    for (const file of fs.readdirSync(dir)) {
      const match = /^(\d+\.\d+\.\d+)\.wxvpkg$/.exec(file);
      if (!match || byVersion.has(match[1])) continue;
      byVersion.set(match[1], {
        version: match[1],
        file: path.join(dir, file),
        compatible: isCompatibleVersion(match[1])
      });
    }
  }

  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * 不指定版本时选择已安装的最新兼容版本。
 * 指定了不兼容的版本也照常返回（compatible=false），由调用方决定是否警告。
 */
export function selectBaseLib(installed: InstalledBaseLib[], version?: string): InstalledBaseLib {
  if (version) {
    const found = installed.find(lib => lib.version === version);
    if (!found) {
      throw new Error(
        `本机没有基础库 ${version}。已安装：${installed.map(l => l.version).join(', ') || '无'}。` +
        '可以在微信开发者工具的「详情 → 本地设置 → 调试基础库」中下载。'
      );
    }
    return found;
  }

  const compatible = installed.find(lib => lib.compatible);
  if (!compatible) {
    throw new Error(
      installed.length === 0
        ? '没有找到微信开发者工具下载的基础库（WeappVendor/*.wxvpkg）。请先安装并打开一次微信开发者工具，或设置 WXA_VENDOR_DIR。'
        : `已安装的基础库都高于 ${MAX_COMPATIBLE_VERSION}，请在开发者工具中下载 ${MAX_COMPATIBLE_VERSION} 或更低版本。`
    );
  }
  return compatible;
}

/** 解包到缓存目录；已解包过的版本直接复用 */
export function extractBaseLib(lib: InstalledBaseLib, cacheDir = DEFAULT_CACHE_DIR): ResolvedBaseLib {
  const dir = path.join(cacheDir, lib.version);
  const marker = path.join(dir, '.complete');

  if (!fs.existsSync(marker)) {
    const buf = fs.readFileSync(lib.file);
    const tmpDir = `${dir}.tmp-${process.pid}`;
    fs.rmSync(tmpDir, { recursive: true, force: true });

    for (const entry of readWxvpkgIndex(buf)) {
      const dest = path.join(tmpDir, entry.name);
      if (!dest.startsWith(tmpDir + path.sep)) {
        throw new Error(`.wxvpkg 中包含非法路径：${entry.name}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, readWxvpkgFile(buf, entry));
    }
    fs.writeFileSync(path.join(tmpDir, '.complete'), lib.file);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(tmpDir, dir);
  }

  return { version: lib.version, dir, compatible: lib.compatible };
}

export function resolveBaseLib(options: { version?: string; cacheDir?: string } = {}): ResolvedBaseLib {
  const lib = selectBaseLib(listInstalledBaseLibs(), options.version);
  return extractBaseLib(lib, options.cacheDir);
}
