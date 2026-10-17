import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  extractBaseLib,
  listBaseLibs,
  listInstalledBaseLibs,
  resolveBaseLib,
  selectBaseLib,
  usesIsolatedContext
} from '../../packages/extractor/src/baselib';
import { findDeveloperTicket, readRegionData, TICKET_ENV } from '../../packages/extractor/src/devtools';
import { readWxvpkgFile, readWxvpkgIndex } from '../../packages/extractor/src/wxvpkg';
import { createProject, packAsar, packWxvpkg } from '../helpers';

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

  it('指定的版本未安装时给出可用的版本', () => {
    expect(() => selectBaseLib(installed, '9.9.9')).toThrow(/可用的版本：3\.10\.1, 3\.7\.0/);
  });

  it('没有任何兼容版本时提示下载', () => {
    expect(() => selectBaseLib(installed.filter(lib => !lib.compatible))).toThrow('请在开发者工具中下载');
  });

  it('开发者工具和内置基础库都没有时，提示两种获取方式', () => {
    expect(() => selectBaseLib([])).toThrow(/微信开发者工具.*@open-wxa\/wxa-baselib/);
  });

  it('版本号逐段按数字比较', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBeGreaterThan(0);
    expect(compareVersions('3.7', '3.7.0')).toBe(0);
  });

  it('3.7.1 起逻辑层分主上下文和子上下文，更早的版本是单个上下文', () => {
    expect(['2.32.3', '3.7.0', '3.7.1', '3.8.8', '3.10.1'].map(usesIsolatedContext)).toEqual([false, false, true, true, true]);
  });
});

describe('用环境变量指定基础库版本', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const vendorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-vendor-'));
  for (const version of ['3.5.8', '3.6.6']) {
    fs.writeFileSync(path.join(vendorDir, `${version}.wxvpkg`), packWxvpkg({ '/WAService.js': version }));
  }
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-cache-'));

  it('没有指定版本时使用 WXA_BASELIB，显式指定的版本优先', () => {
    vi.stubEnv('WXA_VENDOR_DIR', vendorDir);
    vi.stubEnv('WXA_BASELIB', '3.5.8');
    expect(resolveBaseLib({ cacheDir }).version).toBe('3.5.8');
    expect(resolveBaseLib({ version: '3.6.6', cacheDir }).version).toBe('3.6.6');
  });
});

describe('内置基础库兜底', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** 开发者工具的 WeappVendor 目录，选择版本只看文件名，内容留空 */
  const vendorWith = (...versions: string[]) => createProject(Object.fromEntries(versions.map(v => [`${v}.wxvpkg`, ''])));
  const bundledRoot = createProject({ '3.7.0/WAService.js': 'bundled', '3.7.0/WAWebview.js': 'bundled' });

  it('没装开发者工具时使用内置的 3.7.0', () => {
    expect(selectBaseLib(listBaseLibs([], bundledRoot))).toMatchObject({ version: '3.7.0', source: 'bundled' });
  });

  it('开发者工具有同一版本时使用开发者工具的，同一版本只列出一次', () => {
    const libs = listBaseLibs([vendorWith('3.7.0', '3.5.8')], bundledRoot);
    expect(libs.map(lib => `${lib.version} ${lib.source}`)).toEqual(['3.7.0 devtools', '3.5.8 devtools']);
    expect(selectBaseLib(libs).source).toBe('devtools');
  });

  it('开发者工具只有更旧的版本时，默认仍使用内置的 3.7.0；指定旧版本时使用开发者工具的', () => {
    const libs = listBaseLibs([vendorWith('3.5.8')], bundledRoot);
    expect(selectBaseLib(libs)).toMatchObject({ version: '3.7.0', source: 'bundled' });
    expect(selectBaseLib(libs, '3.5.8')).toMatchObject({ version: '3.5.8', source: 'devtools' });
  });

  it('开发者工具只有高于 3.7.0 的版本时，使用内置的 3.7.0 而不是报错', () => {
    expect(selectBaseLib(listBaseLibs([vendorWith('3.10.1')], bundledRoot))).toMatchObject({ version: '3.7.0', source: 'bundled' });
  });

  it('指定的版本哪里都没有时，列出可用的版本并标出内置的', () => {
    expect(() => selectBaseLib(listBaseLibs([vendorWith('3.10.1')], bundledRoot), '9.9.9')).toThrow(/可用的版本：3\.10\.1, 3\.7\.0（内置）/);
  });

  it('没装开发者工具的机器上，解析出内置的 3.7.0，运行时要加载的文件都在', () => {
    vi.stubEnv('WXA_VENDOR_DIR', createProject({}));
    vi.stubEnv('WXA_BASELIB', '');
    const lib = resolveBaseLib();
    expect(lib).toMatchObject({ version: '3.7.0', source: 'bundled', compatible: true });
    expect(fs.existsSync(path.join(lib.dir, 'WAService.js'))).toBe(true);
    expect(fs.existsSync(path.join(lib.dir, 'WAWebview.js'))).toBe(true);
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

describe('行政区划数据', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const DISTRICTS = '440000\t广东省 0';
  const STREETS = '440000000\t广东省\t000000';

  it('从开发者工具安装目录读到省市区和含街道的两份数据', () => {
    const devtools = createProject({
      'package.nw/package.json': '{}',
      'package.nw/js/libs/region_sub_strict_third': DISTRICTS,
      'package.nw/js/libs/region_sub_strict': STREETS
    });
    vi.stubEnv('WXA_DEVTOOLS_PATH', devtools);
    expect(readRegionData('districts')?.toString()).toBe(DISTRICTS);
    expect(readRegionData('streets')?.toString()).toBe(STREETS);
  });

  it('新版开发者工具（Electron）把数据打包在 app.asar 里，同样读得到', () => {
    const devtools = createProject({ 'Contents/Resources/app.asar.unpacked/package.json': '{}' });
    fs.writeFileSync(path.join(devtools, 'Contents/Resources/app.asar'), packAsar({
      'package.json': '{}',
      'js/libs/region_sub_strict_third': DISTRICTS,
      'js/libs/region_sub_strict': STREETS
    }));
    vi.stubEnv('WXA_DEVTOOLS_PATH', devtools);
    expect(readRegionData('districts')?.toString()).toBe(DISTRICTS);
    expect(readRegionData('streets')?.toString()).toBe(STREETS);
  });
});

describe('开发者工具登录态', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const HOUR = 3600_000;

  /** 一个账号的用户数据目录：登录信息按 localStorage 存放，hash_key_map_2.json 记录文件 hash 对应的 key */
  const profile = (user: object | string) => createProject({
    'WeappLocalData/hash_key_map_2.json': { f00: 'reduxPersist:project', a1b2: 'reduxPersist:user' },
    'WeappLocalData/localstorage_a1b2.json': user
  });

  it('取当前用户的 ticket 和过期时间，不和顶层的旧字段混用', () => {
    const expiredAt = Date.now() + HOUR;
    const dir = profile({
      newticket: 'stale', ticketExpiredTime: Date.now() + 9 * HOUR,
      currentUser: { newticket: 'current', ticketExpiredTime: expiredAt, loginStatus: 'SUCCESS' }
    });
    expect(findDeveloperTicket([dir])).toEqual({ newticket: 'current', expiredAt });
  });

  it('多个账号都登录过时取过期时间最晚的；全部过期也返回，由调用方提示刷新', () => {
    const user = (newticket: string, ticketExpiredTime: number) => profile({ currentUser: { newticket, ticketExpiredTime, loginStatus: 'SUCCESS' } });
    const expired = Date.now() - HOUR;
    expect(findDeveloperTicket([user('a', Date.now() + HOUR), user('b', Date.now() + 2 * HOUR)])?.newticket).toBe('b');
    expect(findDeveloperTicket([user('c', expired - HOUR), user('d', expired)])).toEqual({ newticket: 'd', expiredAt: expired });
  });

  it('没有登录成功的账号、没有登录数据的目录当作未登录', () => {
    const loggedOut = profile({ currentUser: { newticket: 't', ticketExpiredTime: Date.now() + HOUR, loginStatus: 'LOGOUT' } });
    expect(findDeveloperTicket([loggedOut, createProject({ 'WeappVendor/x': '' })])).toBeNull();
  });

  it('登录数据读不了时报出所在目录，而不是当作未登录；其它账号可用时仍然用它', () => {
    const broken = profile('{"currentUser":');
    expect(() => findDeveloperTicket([broken])).toThrow(`读取开发者工具登录态失败（${broken}: `);
    const ok = profile({ currentUser: { newticket: 'ok', ticketExpiredTime: Date.now() + HOUR, loginStatus: 'SUCCESS' } });
    expect(findDeveloperTicket([broken, ok])?.newticket).toBe('ok');
  });

  it(`环境变量 ${TICKET_ENV} 优先于开发者工具的登录态`, () => {
    vi.stubEnv(TICKET_ENV, 'from-env');
    const dir = profile({ currentUser: { newticket: 'devtools', ticketExpiredTime: Date.now() + HOUR, loginStatus: 'SUCCESS' } });
    expect(findDeveloperTicket([dir])).toEqual({ newticket: 'from-env' });
  });
});
