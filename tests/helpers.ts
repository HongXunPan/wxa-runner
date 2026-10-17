import fs from 'fs';
import os from 'os';
import path from 'path';
import { findCompilerBinaries } from '../packages/compiler/src/locate';
import { listBaseLibs } from '../packages/extractor/src/baselib';

export const REPO_ROOT = path.resolve(__dirname, '..');
export const EXAMPLES = path.join(REPO_ROOT, 'examples');

/** 在临时目录里按 { 相对路径: 内容 } 创建文件，Buffer 原样写入，其余对象序列化为 JSON */
export function createProject(files: Record<string, string | object>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-runner-test-'));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  return root;
}

/** 按 .wxvpkg 格式打包，用于测试解包器 */
export function packWxvpkg(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, content]) => ({
    name: Buffer.from(name, 'utf8'),
    data: Buffer.from(content, 'utf8')
  }));
  const indexSize = 4 + entries.reduce((sum, entry) => sum + 12 + entry.name.length, 0);
  const header = Buffer.alloc(14);
  header[0] = 0xbe;
  header.writeUInt32BE(0, 1);
  header.writeUInt32BE(indexSize, 5);
  header[13] = 0xed;

  const index = Buffer.alloc(indexSize);
  index.writeUInt32BE(entries.length, 0);
  let pos = 4;
  let offset = header.length + indexSize;
  for (const entry of entries) {
    index.writeUInt32BE(entry.name.length, pos);
    entry.name.copy(index, pos + 4);
    pos += 4 + entry.name.length;
    index.writeUInt32BE(offset, pos);
    index.writeUInt32BE(entry.data.length, pos + 4);
    pos += 8;
    offset += entry.data.length;
  }
  return Buffer.concat([header, index, ...entries.map(entry => entry.data)]);
}

/** 按 Electron 的 .asar 格式打包（新版开发者工具的 app.asar），路径用 / 分隔，如 js/libs/a */
export function packAsar(files: Record<string, string>): Buffer {
  type Dir = { files: Record<string, Dir | { size: number; offset: string }> };
  const root: Dir = { files: {} };
  const contents: Buffer[] = [];
  let offset = 0;
  for (const [file, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const parts = file.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = (dir.files[part] ??= { files: {} }) as Dir;
    dir.files[parts[parts.length - 1]] = { size: data.length, offset: String(offset) };
    contents.push(data);
    offset += data.length;
  }

  // 两段 pickle：[4][文件头长度]，[内容长度][JSON 长度][JSON，补齐到 4 字节]；文件内容紧跟其后
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const payload = Math.ceil((4 + json.length) / 4) * 4;
  const header = Buffer.alloc(12 + payload);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(payload + 4, 4);
  header.writeUInt32LE(payload, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return Buffer.concat([header, ...contents]);
}

/** 编译器和兼容的基础库是否都找得到（开发者工具或内置基础库），依赖它们的测试在没有时跳过 */
export function hasToolchain(): boolean {
  try {
    findCompilerBinaries();
    return listBaseLibs().some(lib => lib.compatible);
  } catch {
    return false;
  }
}
