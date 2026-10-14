/**
 * 定位本机微信开发者工具的安装目录和用户数据目录
 *
 * 基础库（WeappVendor/*.wxvpkg）在用户数据目录，编译器（wcc/wcsc）在安装目录。
 * 两者都可以用环境变量覆盖，便于 CI 或非标准安装位置。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

/** 安装目录下的 package.nw（或 Windows 的 code/package.nw） */
export function findDevtoolsPackageDirs(): string[] {
  const candidates: string[] = [];

  if (process.env.WXA_DEVTOOLS_PATH) {
    const base = process.env.WXA_DEVTOOLS_PATH;
    candidates.push(
      path.join(base, 'Contents/Resources/package.nw'),
      path.join(base, 'code/package.nw'),
      path.join(base, 'package.nw'),
      base
    );
  }

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/wechatwebdevtools.app/Contents/Resources/package.nw',
      path.join(os.homedir(), 'Applications/wechatwebdevtools.app/Contents/Resources/package.nw')
    );
  } else if (process.platform === 'win32') {
    for (const programFiles of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (programFiles) {
        candidates.push(path.join(programFiles, 'Tencent', '微信web开发者工具', 'code', 'package.nw'));
      }
    }
  }

  return candidates.filter(dir => fs.existsSync(path.join(dir, 'package.json')));
}

const REGION_DATA_FILES = {
  districts: 'region_sub_strict_third',
  streets: 'region_sub_strict'
};

export type RegionDataKind = keyof typeof REGION_DATA_FILES;

/**
 * 开发者工具自带的行政区划数据，picker 的地区选择器用它：districts 到区县三级，streets 到街道四级。
 * 找不到时返回 null
 */
export function findRegionDataFile(kind: RegionDataKind): string | null {
  for (const dir of findDevtoolsPackageDirs()) {
    const file = path.join(dir, 'js/libs', REGION_DATA_FILES[kind]);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** 用户数据目录下各账号的目录（每个登录过的账号一个），里面有 WeappVendor、WeappLocalData 等 */
export function findProfileDirs(): string[] {
  const roots: string[] = [];
  if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library/Application Support/微信开发者工具'));
  } else if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, '微信开发者工具', 'User Data'));
  } else {
    roots.push(path.join(os.homedir(), '.config/wechat_devtools'));
  }

  const dirs: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const child of fs.readdirSync(root)) dirs.push(path.join(root, child));
  }
  return dirs;
}

/** 用户数据目录下所有的 WeappVendor 目录 */
export function findVendorDirs(): string[] {
  if (process.env.WXA_VENDOR_DIR) {
    return fs.existsSync(process.env.WXA_VENDOR_DIR) ? [process.env.WXA_VENDOR_DIR] : [];
  }
  return findProfileDirs()
    .map(dir => path.join(dir, 'WeappVendor'))
    .filter(dir => fs.existsSync(dir));
}

/**
 * 指定开发者 ticket 的环境变量，优先于开发者工具的登录态，用于 CI 等没有开发者工具的环境。
 * 不能用 WXA_ 前缀：WXA_ 前缀的变量会下发给浏览器里的 setup
 */
export const TICKET_ENV = 'WECHAT_DEV_TICKET';

export interface DeveloperTicket {
  newticket: string;
  /** 毫秒时间戳；来自环境变量时没有 */
  expiredAt?: number;
}

/**
 * 开发者工具扫码登录后保存的开发者 ticket，向微信换取真实 wx.login code、手机号要用它
 *
 * 环境变量 WECHAT_DEV_TICKET 优先。多个账号都登录过时取过期时间最晚的；
 * 已过期的也会返回，由调用方提示用户刷新登录态。
 *
 * @returns 都没有登录过时返回 null
 * @throws 找不到可用的登录记录、且有登录数据文件读取失败时，消息里带出错的目录
 */
export function findDeveloperTicket(profileDirs: string[] = findProfileDirs()): DeveloperTicket | null {
  if (process.env[TICKET_ENV]) return { newticket: process.env[TICKET_ENV] };

  const tickets: Required<DeveloperTicket>[] = [];
  let readError = '';
  for (const dir of profileDirs) {
    try {
      const ticket = readProfileTicket(path.join(dir, 'WeappLocalData'));
      if (ticket) tickets.push(ticket);
    } catch (error) {
      readError = `${dir}: ${(error as Error).message}`;
    }
  }

  if (tickets.length) return tickets.reduce((latest, ticket) => (ticket.expiredAt > latest.expiredAt ? ticket : latest));
  if (readError) throw new Error(`读取开发者工具登录态失败（${readError}）`);
  return null;
}

/** 登录数据按 localStorage 存放：hash_key_map_2.json 记录 文件 hash → key，登录信息的 key 是 reduxPersist:user */
function readProfileTicket(localDataDir: string): Required<DeveloperTicket> | null {
  const hashMapFile = path.join(localDataDir, 'hash_key_map_2.json');
  if (!fs.existsSync(hashMapFile)) return null;
  const hashMap: Record<string, string> = JSON.parse(fs.readFileSync(hashMapFile, 'utf8'));
  const hash = Object.keys(hashMap).find(key => hashMap[key] === 'reduxPersist:user');
  if (!hash) return null;

  const userFile = path.join(localDataDir, `localstorage_${hash}.json`);
  if (!fs.existsSync(userFile)) return null;
  const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));

  // ticket、过期时间、登录状态都从同一个用户对象取，不和顶层字段混用，免得拼出两个账号的组合
  const user = data.currentUser ?? data;
  if (user.loginStatus !== undefined && user.loginStatus !== 'SUCCESS') return null;
  if (typeof user.newticket !== 'string' || !user.newticket || typeof user.ticketExpiredTime !== 'number') return null;
  return { newticket: user.newticket, expiredAt: user.ticketExpiredTime };
}
