/**
 * 临时文件：canvas 导出、拍照、选图的结果都存在开发服务器上
 *
 * 返回的是 http 地址：image、video 组件只原样使用 http(s) 地址，其余的会被当成页面相对路径；
 * uploadFile 也能直接读取。
 */

/**
 * @param type 扩展名（如 png），读取时按它返回 Content-Type
 * @throws 开发服务器拒绝保存时，带上它给出的原因（如扩展名不合法）
 */
export async function saveTempFile(data: BodyInit, type: string): Promise<string> {
  const res = await fetch(`/__wxa__/tmp?type=${encodeURIComponent(type)}`, { method: 'POST', body: data });
  if (!res.ok) throw new Error(await res.text());
  const { url } = await res.json();
  return url;
}
