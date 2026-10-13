/**
 * 其余 API：内存文件系统、开放接口 Mock、剪贴板等
 *
 * 开放接口（登录、用户信息、支付）在浏览器里无法真实调用，返回可预测的假数据，
 * 测试中可以用 __wxa_test_api__.mock() 覆盖。
 */

import { ApiHandler, fail, ok } from './registry';

const DIR_MODE = 0o40755;
const FILE_MODE = 0o100644;

interface FsNode {
  dir: boolean;
  data: string;
  mtime: number;
}

/** 基础库会往 http://usr/ 写运行日志；业务代码也可以通过 FileSystemManager 读写 */
export class MemoryFileSystem {
  private nodes = new Map<string, FsNode>([['/', { dir: true, data: '', mtime: Date.now() }]]);

  normalize(filePath: string): string {
    const stripped = String(filePath || '').replace(/^[a-z]+:\/\/[^/]*/i, '');
    const parts: string[] = [];
    for (const part of stripped.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  }

  stat(filePath: string): FsNode | undefined {
    return this.nodes.get(this.normalize(filePath));
  }

  mkdir(dirPath: string, recursive = false) {
    const target = this.normalize(dirPath);
    if (this.nodes.has(target)) throw new Error(`file already exists ${dirPath}`);
    const parent = target.slice(0, target.lastIndexOf('/')) || '/';
    if (!this.nodes.get(parent)?.dir) {
      if (!recursive) throw new Error(`no such file or directory ${dirPath}`);
      this.mkdir(parent, true);
    }
    this.nodes.set(target, { dir: true, data: '', mtime: Date.now() });
  }

  write(filePath: string, data: string, append = false) {
    const target = this.normalize(filePath);
    const parent = target.slice(0, target.lastIndexOf('/')) || '/';
    if (!this.nodes.get(parent)?.dir) throw new Error(`no such file or directory ${filePath}`);
    const existing = this.nodes.get(target);
    if (existing?.dir) throw new Error(`illegal operation on a directory ${filePath}`);
    this.nodes.set(target, { dir: false, data: append && existing ? existing.data + data : data, mtime: Date.now() });
  }

  read(filePath: string): string {
    const node = this.stat(filePath);
    if (!node) throw new Error(`no such file or directory, open ${filePath}`);
    if (node.dir) throw new Error(`illegal operation on a directory ${filePath}`);
    return node.data;
  }

  readdir(dirPath: string): string[] {
    const target = this.normalize(dirPath);
    if (!this.nodes.get(target)?.dir) throw new Error(`no such file or directory ${dirPath}`);
    const prefix = target === '/' ? '/' : target + '/';
    return [...this.nodes.keys()]
      .filter(key => key.startsWith(prefix) && key !== target && !key.slice(prefix.length).includes('/'))
      .map(key => key.slice(prefix.length));
  }

  remove(filePath: string, options: { dir: boolean; recursive?: boolean }) {
    const target = this.normalize(filePath);
    const node = this.nodes.get(target);
    if (!node) throw new Error(`no such file or directory ${filePath}`);
    if (node.dir !== options.dir) throw new Error(options.dir ? `not a directory ${filePath}` : `operation not permitted ${filePath}`);
    if (node.dir) {
      const children = this.readdir(target);
      if (children.length && !options.recursive) throw new Error(`directory not empty ${filePath}`);
      for (const key of [...this.nodes.keys()]) if (key.startsWith(target + '/')) this.nodes.delete(key);
    }
    this.nodes.delete(target);
  }
}

export function createMiscApis(appid: string): Record<string, ApiHandler> {
  const fs = new MemoryFileSystem();

  const guard = (api: string, action: () => Record<string, unknown> | void) => {
    try {
      return ok(api, action() || {});
    } catch (error) {
      return fail(api, (error as Error).message);
    }
  };

  const statResult = (node: FsNode) => {
    const stats = {
      mode: node.dir ? DIR_MODE : FILE_MODE,
      size: node.data.length,
      lastAccessedTime: Math.floor(node.mtime / 1000),
      lastModifiedTime: Math.floor(node.mtime / 1000)
    };
    return { stats, ...stats };
  };

  const fileApis: Record<string, ApiHandler> = {
    access: (args, { api }) => (fs.stat(args.path) ? ok(api) : fail(api, `no such file or directory ${args.path}`)),
    stat: (args, { api }) => {
      const node = fs.stat(args.path);
      return node ? ok(api, statResult(node)) : fail(api, `no such file or directory ${args.path}`);
    },
    mkdir: (args, { api }) => guard(api, () => fs.mkdir(args.dirPath, !!args.recursive)),
    writeFile: (args, { api }) => guard(api, () => fs.write(args.filePath, String(args.data ?? ''))),
    appendFile: (args, { api }) => guard(api, () => fs.write(args.filePath, String(args.data ?? ''), true)),
    fs_appendFile: (args, { api }) => guard(api, () => fs.write(args.filePath, String(args.data ?? ''), true)),
    readFile: (args, { api }) => guard(api, () => ({ data: fs.read(args.filePath) })),
    readdir: (args, { api }) => guard(api, () => ({ files: fs.readdir(args.dirPath) })),
    unlink: (args, { api }) => guard(api, () => fs.remove(args.filePath, { dir: false })),
    rmdir: (args, { api }) => guard(api, () => fs.remove(args.dirPath, { dir: true, recursive: !!args.recursive })),
    getFileInfo: (args, { api }) => {
      const node = fs.stat(args.filePath);
      return node ? ok(api, { size: node.data.length }) : fail(api, 'file not exist');
    }
  };
  for (const name of Object.keys(fileApis)) {
    if (!name.startsWith('fs_')) fileApis[name + 'Sync'] = fileApis[name];
  }

  return {
    ...fileApis,

    login: (_args, { api }) => ok(api, { code: `wxa_mock_code_${Date.now().toString(36)}` }),
    checkSession: () => undefined,
    authorize: () => undefined,
    getSetting: (_args, { api }) => ok(api, {
      authSetting: { 'scope.userInfo': true, 'scope.userLocation': true }
    }),
    openSetting: (_args, { api }) => ok(api, { authSetting: {} }),
    getUserInfo: (_args, { api }) => ok(api, { userInfo: mockUser(), rawData: JSON.stringify(mockUser()), signature: '', encryptedData: '', iv: '' }),
    getUserProfile: (_args, { api }) => ok(api, { userInfo: mockUser(), rawData: JSON.stringify(mockUser()), signature: '', encryptedData: '', iv: '' }),
    getAccountInfoSync: (_args, { api }) => ok(api, { miniProgram: { appId: appid, envVersion: 'develop', version: '' } }),
    requestPayment: (_args, { api }) => fail(api, '浏览器运行时不支持支付，请在测试中通过 __wxa_test_api__.mock("requestPayment", ...) 模拟'),
    getLocation: (_args, { api }) => ok(api, { latitude: 39.908823, longitude: 116.39747, speed: 0, accuracy: 65, altitude: 0, verticalAccuracy: 65, horizontalAccuracy: 65 }),
    scanCode: (_args, { api }) => fail(api, 'cancel'),

    setClipboardData: async (args) => {
      clipboard = String(args.data ?? '');
      await navigator.clipboard?.writeText(clipboard).catch(() => undefined);
    },
    getClipboardData: (_args, { api }) => ok(api, { data: clipboard }),
    makePhoneCall: (args) => console.info(`[wxa-runner] makePhoneCall ${args.phoneNumber}`),
    showShareMenu: () => undefined,
    hideShareMenu: () => undefined,
    updateShareMenu: () => undefined
  };
}

let clipboard = '';

function mockUser() {
  return { nickName: 'wxa-runner', avatarUrl: '', gender: 0, country: '', province: '', city: '', language: 'zh_CN' };
}
