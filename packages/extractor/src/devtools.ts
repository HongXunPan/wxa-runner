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

/** 用户数据目录下所有的 WeappVendor 目录（每个登录过的账号一个） */
export function findVendorDirs(): string[] {
  if (process.env.WXA_VENDOR_DIR) {
    return fs.existsSync(process.env.WXA_VENDOR_DIR) ? [process.env.WXA_VENDOR_DIR] : [];
  }

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
    for (const child of fs.readdirSync(root)) {
      const vendor = path.join(root, child, 'WeappVendor');
      if (fs.existsSync(vendor)) dirs.push(vendor);
    }
  }
  return dirs;
}
