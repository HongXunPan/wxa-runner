import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  extractBaseLib,
  listInstalledBaseLibs,
  selectBaseLib
} from '../../packages/extractor/src/baselib';
import { readWxvpkgFile, readWxvpkgIndex } from '../../packages/extractor/src/wxvpkg';
import { packWxvpkg } from '../helpers';

describe('wxvpkg 解包', () => {
  it('读出包内每个文件的名称和内容', () => {
    const buf = packWxvpkg({ '/WAService.js': 'service', '/sub/WAWebview.js': 'webview' });
    const entries = readWxvpkgIndex(buf);

    expect(entries.map(e => e.name)).toEqual(['/WAService.js', '/sub/WAWebview.js']);
    expect(readWxvpkgFile(buf, entries[1]).toString()).toBe('webview');
  });

  it('魔数不对时拒绝解析', () => {
    expect(() => readWxvpkgIndex(Buffer.from('not a package at all'))).toThrow('不是有效的 .wxvpkg 文件');
  });

  it('文件范围超出包体时报告损坏', () => {
    const buf = packWxvpkg({ '/a.js': 'abcdef' });
    expect(() => readWxvpkgIndex(buf.subarray(0, buf.length - 3))).toThrow('已损坏');
  });
});

describe('基础库版本选择', () => {
  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-vendor-'));
  for (const version of ['2.32.3', '3.7.0', '3.10.1', '3.6.6']) {
    fs.writeFileSync(path.join(vendorDir, `${version}.wxvpkg`), packWxvpkg({ '/WAService.js': version }));
  }
  fs.writeFileSync(path.join(vendorDir, 'development.wxvpkg'), '');
  const installed = listInstalledBaseLibs([vendorDir]);

  it('按版本号从新到旧列出，忽略非版本命名的包', () => {
    expect(installed.map(lib => lib.version)).toEqual(['3.10.1', '3.7.0', '3.6.6', '2.32.3']);
    expect(installed.find(lib => lib.version === '3.10.1')!.compatible).toBe(false);
  });

  it('默认选择最新的兼容版本', () => {
    expect(selectBaseLib(installed).version).toBe('3.7.0');
  });

  it('指定的版本即使不兼容也会返回，并标记出来', () => {
    expect(selectBaseLib(installed, '3.10.1').compatible).toBe(false);
  });

  it('指定的版本未安装时给出已安装列表', () => {
    expect(() => selectBaseLib(installed, '9.9.9')).toThrow(/已安装：3\.10\.1, 3\.7\.0/);
  });

  it('没有任何兼容版本时提示下载', () => {
    expect(() => selectBaseLib(installed.filter(lib => !lib.compatible))).toThrow('请在开发者工具中下载');
  });

  it('版本号逐段按数字比较', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0);
    expect(compareVersions('3.7', '3.7.0')).toBe(0);
  });
});

describe('基础库解包缓存', () => {
  it('解包到缓存目录，已存在时直接复用', () => {
    const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-vendor-'));
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-cache-'));
    const file = path.join(vendorDir, '3.7.0.wxvpkg');
    fs.writeFileSync(file, packWxvpkg({ '/WAService.js': 'v1', '/WAWebview.js': 'w' }));
    const [lib] = listInstalledBaseLibs([vendorDir]);

    const first = extractBaseLib(lib, cacheDir);
    expect(fs.readFileSync(path.join(first.dir, 'WAService.js'), 'utf8')).toBe('v1');

    fs.writeFileSync(file, packWxvpkg({ '/WAService.js': 'v2' }));
    const second = extractBaseLib(lib, cacheDir);
    expect(fs.readFileSync(path.join(second.dir, 'WAService.js'), 'utf8')).toBe('v1');
  });

  it('拒绝写出包目录之外的路径', () => {
    const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-vendor-'));
    fs.writeFileSync(path.join(vendorDir, '3.7.0.wxvpkg'), packWxvpkg({ '/../../evil.js': 'x' }));
    const [lib] = listInstalledBaseLibs([vendorDir]);
    expect(() => extractBaseLib(lib, fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-cache-')))).toThrow('非法路径');
  });
});
