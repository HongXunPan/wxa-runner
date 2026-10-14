import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  extractBaseLib,
  listInstalledBaseLibs,
  selectBaseLib
} from '../../packages/extractor/src/baselib';
import { findDeveloperTicket, findRegionDataFile, TICKET_ENV } from '../../packages/extractor/src/devtools';
import { readWxvpkgFile, readWxvpkgIndex } from '../../packages/extractor/src/wxvpkg';
import { createProject, packWxvpkg } from '../helpers';

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

describe('行政区划数据', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('从开发者工具安装目录找到省市区和含街道的两份数据', () => {
    const devtools = createProject({
      'package.nw/package.json': '{}',
      'package.nw/js/libs/region_sub_strict_third': '440000\t广东省 0',
      'package.nw/js/libs/region_sub_strict': '440000000\t广东省\t000000'
    });
    vi.stubEnv('WXA_DEVTOOLS_PATH', devtools);
    expect(findRegionDataFile('districts')).toBe(path.join(devtools, 'package.nw/js/libs/region_sub_strict_third'));
    expect(findRegionDataFile('streets')).toBe(path.join(devtools, 'package.nw/js/libs/region_sub_strict'));
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
