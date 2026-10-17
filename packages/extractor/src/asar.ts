/**
 * 从 Electron 的 .asar 归档里读单个文件。新版开发者工具（Electron）把大部分程序文件打包在 app.asar 里
 *
 * 文件格式（小端序）：
 *   0    u32  4
 *   4    u32  文件头长度 H
 *   8    u32  文件头内容长度
 *   12   u32  JSON 长度 N
 *   16        JSON 目录 { files: { 名称: 子目录 { files } 或文件 { size, offset } } }，offset 是十进制字符串
 *   8+H       文件内容，各文件从 8 + H + offset 开始
 */

import fs from 'fs';

interface AsarNode {
  files?: Record<string, AsarNode>;
  size?: number;
  offset?: string;
}

/**
 * @param filePath 归档内的路径，用 / 分隔，如 js/libs/region_sub_strict
 * @returns 文件不存在，或它被放在 app.asar.unpacked 里（目录里没有 offset）时为 null
 */
export function readAsarFile(archive: string, filePath: string): Buffer | null {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizes = Buffer.alloc(16);
    fs.readSync(fd, sizes, 0, sizes.length, 0);
    const headerSize = sizes.readUInt32LE(4);
    const json = Buffer.alloc(sizes.readUInt32LE(12));
    fs.readSync(fd, json, 0, json.length, 16);

    let node: AsarNode | undefined = JSON.parse(json.toString('utf8'));
    for (const name of filePath.split('/').filter(Boolean)) {
      node = node?.files && Object.prototype.hasOwnProperty.call(node.files, name) ? node.files[name] : undefined;
    }
    if (node?.offset === undefined || node.size === undefined) return null;

    const data = Buffer.alloc(node.size);
    fs.readSync(fd, data, 0, node.size, 8 + headerSize + Number(node.offset));
    return data;
  } finally {
    fs.closeSync(fd);
  }
}
