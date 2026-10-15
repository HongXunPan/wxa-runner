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

/** 编译器和兼容的基础库是否都找得到（开发者工具或内置基础库），依赖它们的测试在没有时跳过 */
export function hasToolchain(): boolean {
  try {
    findCompilerBinaries();
    return listBaseLibs().some(lib => lib.compatible);
  } catch {
    return false;
  }
}
