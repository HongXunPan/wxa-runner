/**
 * .wxvpkg 解包器
 *
 * 文件格式（大端序）：
 *   0      u8   0xBE 魔数
 *   1..12       保留字段（info、索引长度、数据长度）
 *   13     u8   0xED 索引起始标记
 *   14     u32  文件数量
 *   之后每个文件：u32 名称长度 + 名称(utf8) + u32 偏移 + u32 长度
 */

export interface WxvpkgEntry {
  /** 包内路径，如 "/WAService.js" */
  name: string;
  offset: number;
  size: number;
}

const HEAD_MAGIC = 0xbe;
const INDEX_MAGIC = 0xed;

export function readWxvpkgIndex(buf: Buffer): WxvpkgEntry[] {
  if (buf.length < 18 || buf[0] !== HEAD_MAGIC || buf[13] !== INDEX_MAGIC) {
    throw new Error('不是有效的 .wxvpkg 文件');
  }

  const count = buf.readUInt32BE(14);
  const entries: WxvpkgEntry[] = [];
  let pos = 18;

  for (let i = 0; i < count; i++) {
    const nameLength = buf.readUInt32BE(pos);
    pos += 4;
    const name = buf.toString('utf8', pos, pos + nameLength);
    pos += nameLength;
    const offset = buf.readUInt32BE(pos);
    const size = buf.readUInt32BE(pos + 4);
    pos += 8;

    if (offset + size > buf.length) {
      throw new Error(`.wxvpkg 已损坏：${name} 超出文件范围`);
    }
    entries.push({ name, offset, size });
  }

  return entries;
}

export function readWxvpkgFile(buf: Buffer, entry: WxvpkgEntry): Buffer {
  return buf.subarray(entry.offset, entry.offset + entry.size);
}
