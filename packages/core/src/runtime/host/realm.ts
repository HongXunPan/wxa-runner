/**
 * 宿主交给 iframe 的值，在目标 iframe 的全局环境（realm）里重建
 *
 * 宿主、逻辑层、渲染层是不同的 iframe，各有一套 Object / Array / ArrayBuffer。属于别的 iframe 的值，
 * 在目标 iframe 里 instanceof 不成立，基础库的 setData 也会把这样的数组当成普通对象。
 */

/** 在目标 iframe 的 realm 中重建数据，避免跨 realm 的 instanceof 判断失效 */
export function cloneInto<T>(win: Window, value: T): T {
  if (value === undefined) return value;
  return (win as any).JSON.parse(JSON.stringify(value));
}

const BUFFER_KEY = '__wxa_array_buffer__';

/**
 * 原生接口的结果和事件交给 iframe：同 cloneInto，另外把 ArrayBuffer（readFile 读到的文件、按 arraybuffer 请求到的数据、
 * WebSocket 的二进制消息）复制成目标 realm 的。
 * 只有原生接口会给出 ArrayBuffer；setData 等消息数据量大，仍走 cloneInto，省掉逐个字段的检查
 */
export function cloneNativeInto<T>(win: Window, value: T): T {
  if (value === undefined) return value;
  const buffers: ArrayBuffer[] = [];
  const json = JSON.stringify(value, (_key, item) => {
    if (Object.prototype.toString.call(item) !== '[object ArrayBuffer]') return item;
    buffers.push(item);
    return { [BUFFER_KEY]: buffers.length - 1 };
  });
  const targetJson: JSON = (win as any).JSON;
  if (!buffers.length) return targetJson.parse(json);
  return targetJson.parse(json, (_key, item) => (item?.[BUFFER_KEY] === undefined ? item : copyBuffer(win, buffers[item[BUFFER_KEY]])));
}

function copyBuffer(win: Window, source: ArrayBuffer): ArrayBuffer {
  const copy: ArrayBuffer = new (win as any).ArrayBuffer(source.byteLength);
  new Uint8Array(copy).set(new Uint8Array(source));
  return copy;
}
