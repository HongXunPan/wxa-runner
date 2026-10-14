/**
 * 端到端：画布与相机
 *
 * 旧版 canvas（canvas-id）的绘制指令由逻辑层发出、不指定目标页面；
 * 导出图片和拍照得到的临时文件要能直接作为 image 的 src 显示。
 */

import { afterAll, beforeAll, describe, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const CANVAS_WXML = `
<canvas canvas-id="legacy" style="width:100px;height:100px"></canvas>
<canvas type="2d" id="modern" style="width:120px;height:80px"></canvas>
<view id="drawn">{{drawn}}</view>
<view id="legacy-pixel">{{legacyPixel}}</view>
<image wx:if="{{exportedFile}}" src="{{exportedFile}}" bindload="onExportedLoad" binderror="onExportedError" style="width:120px;height:80px"></image>
<view id="exported">{{exported}}</view>
<image wx:if="{{legacyFile}}" src="{{legacyFile}}" bindload="onLegacyExportedLoad" style="width:100px;height:100px"></image>
<view id="legacy-exported">{{legacyExported}}</view>
`;

const CANVAS_JS = `
Page({
  data: { drawn: '', legacyPixel: '', exportedFile: '', exported: '', legacyFile: '', legacyExported: '' },
  onReady() {
    const ctx = wx.createCanvasContext('legacy', this);
    ctx.setFillStyle('#ff0000');
    ctx.fillRect(0, 0, 100, 100);
    ctx.draw(false, () => {
      this.setData({ drawn: 'yes' });
      wx.canvasGetImageData({
        canvasId: 'legacy', x: 50, y: 50, width: 1, height: 1,
        success: res => this.setData({ legacyPixel: Array.from(res.data).join(',') }),
        fail: err => this.setData({ legacyPixel: err.errMsg })
      }, this);
      wx.canvasToTempFilePath({
        canvasId: 'legacy',
        success: r => this.setData({ legacyFile: r.tempFilePath, legacyExported: r.tempFilePath ? '' : 'empty path' }),
        fail: err => this.setData({ legacyExported: 'fail ' + err.errMsg })
      }, this);
    });

    wx.createSelectorQuery().select('#modern').fields({ node: true, size: true }).exec(([res]) => {
      const canvas = res.node;
      const c = canvas.getContext('2d');
      c.fillStyle = '#00ff00';
      c.fillRect(0, 0, canvas.width, canvas.height);
      wx.canvasToTempFilePath({
        canvas,
        success: r => this.setData({ exportedFile: r.tempFilePath, exported: r.tempFilePath ? '' : 'empty path' }),
        fail: err => this.setData({ exported: 'fail ' + err.errMsg })
      });
    });
  },
  onExportedLoad(e) { this.setData({ exported: 'loaded ' + e.detail.width + 'x' + e.detail.height }); },
  onExportedError(e) { this.setData({ exported: 'error ' + e.detail.errMsg }); },
  onLegacyExportedLoad(e) { this.setData({ legacyExported: 'loaded ' + e.detail.width + 'x' + e.detail.height }); }
});
`;

const CAMERA_WXML = `
<camera bindinitdone="onCameraReady" binderror="onCameraError" style="width:200px;height:150px"></camera>
<button id="shoot" bindtap="shoot">拍照</button>
<view id="camera-state">{{state}}</view>
<image wx:if="{{photoFile}}" src="{{photoFile}}" bindload="onPhotoLoad" binderror="onPhotoError" style="width:200px;height:150px"></image>
<view id="photo">{{photo}}</view>
`;

const CAMERA_JS = `
Page({
  data: { state: '', photoFile: '', photo: '' },
  onCameraReady() { this.setData({ state: 'ready' }); },
  onCameraError(e) { this.setData({ state: 'error ' + e.detail.errMsg }); },
  shoot() {
    wx.createCameraContext().takePhoto({
      quality: 'low',
      success: r => this.setData({ photoFile: r.tempImagePath, photo: r.tempImagePath ? '' : 'empty path' }),
      fail: err => this.setData({ photo: 'fail ' + err.errMsg })
    });
  },
  onPhotoLoad(e) { this.setData({ photo: 'loaded ' + e.detail.width + 'x' + e.detail.height }); },
  onPhotoError(e) { this.setData({ photo: 'error ' + e.detail.errMsg }); }
});
`;

describe.skipIf(!e2eReady)('画布与相机', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/canvas/canvas', 'pages/camera/camera'] },
      'pages/canvas/canvas.json': {},
      'pages/canvas/canvas.wxml': CANVAS_WXML,
      'pages/canvas/canvas.js': CANVAS_JS,
      'pages/camera/camera.json': {},
      'pages/camera/camera.wxml': CAMERA_WXML,
      'pages/camera/camera.js': CAMERA_JS
    }, {
      // 用 Chrome 自带的模拟摄像头，不弹授权框
      chromeArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      permissions: ['camera']
    });
  });

  afterAll(() => runner?.close());

  it('页面在 canvas-id 画布上绘制后，draw 回调触发，读回的像素是画上去的颜色', async () => {
    const frame = await runner.open('/?path=pages/canvas/canvas');
    await expectText(frame, '#drawn', 'yes');
    await expectText(frame, '#legacy-pixel', '255,0,0,255');
  });

  it('canvasToTempFilePath 导出的图片可以直接作为 image 的 src 显示，新旧两种画布都可以', async () => {
    const frame = await runner.open('/?path=pages/canvas/canvas');
    await expectText(frame, '#exported', /^loaded [1-9]\d*x[1-9]\d*$/);
    await expectText(frame, '#legacy-exported', /^loaded [1-9]\d*x[1-9]\d*$/);
  });

  it('用户拍照后得到的照片可以直接作为 image 的 src 显示', async () => {
    const frame = await runner.open('/?path=pages/camera/camera');
    await expectText(frame, '#camera-state', 'ready');
    await frame.click('#shoot');
    await expectText(frame, '#photo', /^loaded [1-9]\d*x[1-9]\d*$/);
  });
});
