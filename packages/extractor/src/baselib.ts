/**
 * 基础库版本选择与提取
 *
 * 基础库有两个来源：本机开发者工具下载的 .wxvpkg（用时解包到缓存目录），
 * 和内置基础库 @open-wxa/wxa-baselib（已解包，给没有开发者工具的 Linux / CI 用）。
 * 同一版本优先用开发者工具的，内置的只在开发者工具没有该版本时兜底。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { findVendorDirs } from './devtools';
import { readWxvpkgFile, readWxvpkgIndex } from './wxvpkg';

/**
 * 已验证的最高版本：不指定版本时只在这个范围里选，指定更高的版本照常运行，但会警告
 */
export const MAX_COMPATIBLE_VERSION = '3.7.0';

/**
 * 从这个版本起，逻辑层分主上下文和子上下文：业务代码放进由原生 WeixinJSContext 创建的
 * 隔离上下文（3.8 起 WAService.js 只是占位），运行时按此切换加载方式，见 core/runtime/context.ts。
 * 与 MAX_COMPATIBLE_VERSION 无关：提高已验证的范围不改变某个版本的结构
 */
export const ISOLATED_CONTEXT_SINCE = '3.7.1';

export const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.wxa-runner', 'baselib');

export const BUNDLED_BASELIB_PACKAGE = '@open-wxa/wxa-baselib';

/** 开发者工具下载的基础库 */
export interface InstalledBaseLib {
  source: 'devtools';
  version: string;
  /** .wxvpkg 文件，用时解包 */
  file: string;
  compatible: boolean;
}

export interface ResolvedBaseLib {
  source: 'devtools' | 'bundled';
  version: string;
  /** 解包后的目录，包含 WAService.js / WAWebview.js 等 */
  dir: string;
  compatible: boolean;
}

/** 内置基础库里的一个版本，已经是解包后的目录 */
export interface BundledBaseLib extends ResolvedBaseLib {
  source: 'bundled';
}

export type BaseLib = InstalledBaseLib | BundledBaseLib;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function usesIsolatedContext(version: string): boolean {
  return compareVersions(version, ISOLATED_CONTEXT_SINCE) >= 0;
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
        source: 'devtools',
        version: match[1],
        file: path.join(dir, file),
        compatible: isCompatibleVersion(match[1])
      });
    }
  }

  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** 内置基础库的安装目录；它是可选依赖，没装上时返回 null */
export function findBundledBaseLibRoot(): string | null {
  try {
    return path.dirname(require.resolve(`${BUNDLED_BASELIB_PACKAGE}/package.json`));
  } catch {
    return null;
  }
}

/**
 * 开发者工具和内置基础库里的所有版本，从新到旧；同一版本只列开发者工具的
 *
 * @param bundledRoot 内置基础库目录，下面每个版本一个子目录；为 null 时只列开发者工具的
 */
export function listBaseLibs(vendorDirs = findVendorDirs(), bundledRoot = findBundledBaseLibRoot()): BaseLib[] {
  const installed = listInstalledBaseLibs(vendorDirs);
  const bundled: BundledBaseLib[] = (bundledRoot ? fs.readdirSync(bundledRoot) : [])
    .filter(name => /^\d+\.\d+\.\d+$/.test(name) && !installed.some(lib => lib.version === name))
    .map(version => ({ source: 'bundled', version, dir: path.join(bundledRoot!, version), compatible: isCompatibleVersion(version) }));

  return [...installed, ...bundled].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * 不指定版本时选择最新的兼容版本。
 * 指定了不兼容的版本也照常返回（compatible=false），由调用方决定是否警告。
 */
export function selectBaseLib<T extends BaseLib>(libs: T[], version?: string): T {
  if (version) {
    const found = libs.find(lib => lib.version === version);
    if (!found) {
      const available = libs.map(lib => (lib.source === 'bundled' ? `${lib.version}（内置）` : lib.version));
      throw new Error(
        `没有基础库 ${version}。可用的版本：${available.join(', ') || '无'}。` +
        '可以在微信开发者工具的「详情 → 本地设置 → 调试基础库」中下载。'
      );
    }
    return found;
  }

  const compatible = libs.find(lib => lib.compatible);
  if (!compatible) {
    throw new Error(
      libs.length === 0
        ? '没有找到基础库：本机没有微信开发者工具下载的基础库（WeappVendor/*.wxvpkg），' +
          `也没有安装内置基础库 ${BUNDLED_BASELIB_PACKAGE}。请安装并打开一次微信开发者工具（或设置 WXA_VENDOR_DIR），或重新安装依赖。`
        : `可用的基础库都高于 ${MAX_COMPATIBLE_VERSION}，请在开发者工具中下载 ${MAX_COMPATIBLE_VERSION} 或更低版本。`
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

  return { source: 'devtools', version: lib.version, dir, compatible: lib.compatible };
}

/** 没指定版本时用环境变量 WXA_BASELIB 指定的版本，如 WXA_BASELIB=3.8.8 pnpm test 在这个版本上跑全部测试 */
export function resolveBaseLib(options: { version?: string; cacheDir?: string } = {}): ResolvedBaseLib {
  const lib = selectBaseLib(listBaseLibs(), options.version || process.env.WXA_BASELIB || undefined);
  return lib.source === 'bundled' ? lib : extractBaseLib(lib, options.cacheDir);
}
