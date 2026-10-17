/**
 * 把基础库脚本加入 Chrome DevTools 的忽略列表（source map 的 x_google_ignoreList），调试时只看业务代码
 *
 * 新版基础库用 BaseConsole 包装 console 来收集日志，业务代码的 console.log 在 DevTools 里显示的来源
 * 成了这层包装（3.17 起基础库自己把它命名为 __WXAPPLIB_IGNORE__，就是留给调试工具跳过的）。
 * 忽略列表里的帧会被 DevTools 跳过：控制台的来源链接、调用栈、单步调试都落到业务代码上。
 * source map 只在打开 DevTools 时才会请求，不影响运行。
 *
 * 映射是恒等的：原始代码就是脚本本身，每行按固定间隔打点；从忽略列表里移除后仍能在基础库里调试，
 * 位置误差不超过一个间隔
 */

/** 打点间隔（列）：基础库压缩成很长的行，逐字符映射太大 */
const STRIDE = 100;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** @param source 原始代码的地址，相对 source map 的地址解析 */
export function ignoreListSourceMap(code: string, source: string): string {
  let previousColumn = 0;
  const mappings = code.split('\n').map((line, index) => {
    const segments: string[] = [];
    for (let column = 0; column === 0 || column < line.length; column += STRIDE) {
      // 各字段都是相对上一个打点的增量：生成列（每行从 0 重新算）、源文件、源行、源列
      const sourceLine = column === 0 && index > 0 ? 1 : 0;
      segments.push(vlq(column === 0 ? 0 : STRIDE) + vlq(0) + vlq(sourceLine) + vlq(column - previousColumn));
      previousColumn = column;
    }
    return segments.join(',');
  });
  return JSON.stringify({ version: 3, sources: [source], names: [], mappings: mappings.join(';'), x_google_ignoreList: [0] });
}

function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}
