/**
 * 端到端：临时文件的信息与保存的文件
 *
 * 临时文件和保存的文件都在开发服务器上。Painter 等库下载图片后要用 getFileInfo 查大小、
 * 用 saveFile 缓存起来，下次先用 getSavedFileInfo 检查缓存的文件还在不在。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, Runner, startRunner } from './runner';

const PAGE_JS = `
Page({
  // 和业务代码一样调用接口，成功和失败的结果都交回给测试
  call(api, args) {
    return new Promise(resolve => wx[api]({ ...args, success: resolve, fail: resolve }));
  },
  callFs(api, args) {
    return new Promise(resolve => wx.getFileSystemManager()[api]({ ...args, success: resolve, fail: resolve }));
  }
});
`;

describe.skipIf(!e2eReady)('临时文件与保存的文件', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view>files</view>',
      'pages/index/index.js': PAGE_JS,
      'files/hello.txt': 'hello wxa'
    });
  });

  afterAll(() => runner?.close());

  const call = (api: string, args: object = {}) =>
    runner.page.evaluate(([a, b]) => window.__wxa_test_api__.callPageMethod('call', a, b), [api, args] as const) as Promise<any>;
  const callFs = (api: string, args: object) =>
    runner.page.evaluate(([a, b]) => window.__wxa_test_api__.callPageMethod('callFs', a, b), [api, args] as const) as Promise<any>;
  const fetchText = (url: string) =>
    runner.page.evaluate(async u => {
      const res = await fetch(u);
      return res.ok ? res.text() : `HTTP ${res.status}`;
    }, url);
  const savedPaths = async () => (await call('getSavedFileList')).fileList.map((file: { filePath: string }) => file.filePath);

  /** 打开页面，下载一个 9 字节的文件，返回临时文件地址 */
  async function downloadHello(): Promise<string> {
    await runner.open('/?path=pages/index/index');
    const { tempFilePath } = await call('downloadFile', { url: `${runner.base}/files/hello.txt` });
    return tempFilePath;
  }

  it('getFileInfo 能查到下载得到的临时文件的大小，文件不存在时失败', async () => {
    const tempFilePath = await downloadHello();

    expect(await call('getFileInfo', { filePath: tempFilePath })).toMatchObject({ errMsg: 'getFileInfo:ok', size: 9 });
    const missing = tempFilePath.replace(/[^/]+$/, 'missing.txt');
    expect((await call('getFileInfo', { filePath: missing })).errMsg).toMatch(/^getFileInfo:fail /);
  });

  it('saveFile 把临时文件存成新文件，新地址能读到原内容，原来的临时文件随之删除', async () => {
    const tempFilePath = await downloadHello();

    const { errMsg, savedFilePath } = await call('saveFile', { tempFilePath });

    expect(errMsg).toBe('saveFile:ok');
    expect(savedFilePath).not.toBe(tempFilePath);
    expect(await fetchText(savedFilePath)).toBe('hello wxa');
    expect((await call('getFileInfo', { filePath: tempFilePath })).errMsg).toMatch(/^getFileInfo:fail /);
  });

  it('保存的文件出现在 getSavedFileList 里，getSavedFileInfo 能查到大小和保存时间，整页刷新后仍然在', async () => {
    const { savedFilePath } = await call('saveFile', { tempFilePath: await downloadHello() });

    await runner.open('/?path=pages/index/index');

    const { fileList } = await call('getSavedFileList');
    expect(fileList).toContainEqual({ filePath: savedFilePath, size: 9, createTime: expect.any(Number) });
    const info = await call('getSavedFileInfo', { filePath: savedFilePath });
    expect(info).toMatchObject({ errMsg: 'getSavedFileInfo:ok', size: 9 });
    // 和真机一样以秒计
    expect(Math.abs(info.createTime - Date.now() / 1000)).toBeLessThan(60);
  });

  it('removeSavedFile 后，保存的文件查不到、不在列表里，地址也打不开', async () => {
    const { savedFilePath } = await call('saveFile', { tempFilePath: await downloadHello() });

    expect((await call('removeSavedFile', { filePath: savedFilePath })).errMsg).toBe('removeSavedFile:ok');

    expect((await call('getSavedFileInfo', { filePath: savedFilePath })).errMsg).toMatch(/^getSavedFileInfo:fail /);
    expect(await savedPaths()).not.toContain(savedFilePath);
    expect(await fetchText(savedFilePath)).toBe('HTTP 404');
  });

  it('开发服务器上的文件没了（如重启过），保存记录随之失效：查不到，列表里也没有', async () => {
    const { savedFilePath } = await call('saveFile', { tempFilePath: await downloadHello() });

    await runner.page.evaluate(url => fetch(url, { method: 'DELETE' }), savedFilePath);

    expect((await call('getSavedFileInfo', { filePath: savedFilePath })).errMsg).toMatch(/^getSavedFileInfo:fail /);
    expect(await savedPaths()).not.toContain(savedFilePath);
  });

  it('FileSystemManager 的 saveFile 指定保存位置时明确失败，不假装成功', async () => {
    const tempFilePath = await downloadHello();

    const result = await callFs('saveFile', { tempFilePath, filePath: 'http://usr/hello.txt' });

    expect(result.errMsg).toMatch(/^saveFile:fail /);
  });
});
