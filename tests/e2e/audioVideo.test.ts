/**
 * 端到端：音频与视频
 *
 * 平台是 devtools 时，基础库自己用网页实现 video 组件和 InnerAudioContext：video 渲染成 HTML 的 <video>；
 * InnerAudioContext 用 Web Audio 播放，网络音频经基础库的内部请求下载，代码包里的音频经 readFile 读取。
 * video 组件只接受网络地址和临时文件（基础库的限制），所以视频由业务服务器提供。
 */

import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

/** 单声道 16 位 PCM 的正弦波 wav */
function sineWav(seconds: number, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // 单声道
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples * 2, 40);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), i * 2);
  return Buffer.concat([header, pcm]);
}

const TONE = sineWav(1);
const LONG_TONE = sineWav(2);
const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures/clip-2s.webm'));

const AUDIO_WXML = `
<button id="play" bindtap="onPlay">播放</button>
<view id="events">{{events}}</view>
<view id="duration">{{duration}}</view>
<button id="play-seek" bindtap="onPlayAndSeek">播放，开始后跳到 1 秒</button>
<view id="after-seek">{{afterSeek}}</view>
<view id="seek-ended">{{seekEnded}}</view>
`;

// 每种事件只记第一次，按先后顺序
const AUDIO_JS = `
Page({
  data: { events: '', duration: '', afterSeek: '', seekEnded: '' },
  onLoad(query) { this.src = decodeURIComponent(query.src); },
  onPlay() {
    const audio = wx.createInnerAudioContext();
    const seen = [];
    const record = name => {
      if (seen.includes(name)) return;
      seen.push(name);
      this.setData({ events: seen.join(',') });
    };
    audio.onCanplay(() => record('canplay'));
    audio.onPlay(() => record('play'));
    audio.onTimeUpdate(() => record('timeupdate'));
    audio.onEnded(() => {
      record('ended');
      this.setData({ duration: audio.duration.toFixed(1) });
    });
    audio.onError(err => record('error ' + err.errMsg));
    audio.src = this.src;
    audio.play();
  },
  // 第一次 timeupdate 时跳到 1 秒；跳转完成后又收到 timeupdate 说明进度还在更新
  onPlayAndSeek() {
    const audio = wx.createInnerAudioContext();
    let seekIssued = false;
    let seeked = false;
    audio.onTimeUpdate(() => {
      if (!seekIssued) {
        seekIssued = true;
        audio.seek(1);
      } else if (seeked && audio.currentTime >= 1) {
        this.setData({ afterSeek: 'continued' });
      }
    });
    audio.onSeeked(() => { seeked = true; });
    audio.onEnded(() => this.setData({ seekEnded: 'ended' }));
    audio.onError(err => this.setData({ seekEnded: 'error ' + err.errMsg }));
    audio.src = this.src;
    audio.play();
  }
});
`;

const VIDEO_WXML = `
<video id="player" src="{{src}}" muted bindloadedmetadata="onLoaded" bindplay="onPlaying" bindtimeupdate="onTimeUpdate" bindended="onEnded" binderror="onError"></video>
<button id="play" bindtap="onPlay">播放</button>
<view id="ready">{{ready}}</view>
<view id="events">{{events}}</view>
<view id="positions">{{positions}}</view>
`;

// 开始播放就跳到 1.5 秒；positions 是 timeupdate 报告的每个播放位置
const VIDEO_JS = `
Page({
  data: { src: '', ready: '', events: '', positions: '' },
  onLoad(query) { this.setData({ src: decodeURIComponent(query.src) }); },
  record(name) {
    const seen = this.data.events ? this.data.events.split(',') : [];
    if (!seen.includes(name)) this.setData({ events: seen.concat(name).join(',') });
  },
  onLoaded() { this.setData({ ready: 'yes' }); },
  onPlaying() {
    this.record('play');
    if (this.seeked) return;
    this.seeked = true;
    wx.createVideoContext('player').seek(1.5);
  },
  onTimeUpdate(e) {
    this.record('timeupdate');
    this.setData({ positions: (this.data.positions ? this.data.positions + ',' : '') + e.detail.currentTime.toFixed(2) });
  },
  onEnded() { this.record('ended'); },
  onError(e) { this.record('error ' + e.detail.errMsg); },
  onPlay() { wx.createVideoContext('player').play(); }
});
`;

const FILE_WXML = `
<button id="read" bindtap="onRead">读取包内文件</button>
<view id="binary">{{binary}}</view>
<view id="text">{{text}}</view>
`;

const FILE_JS = `
Page({
  data: { binary: '', text: '' },
  onRead() {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: '/assets/data.bin',
      success: ({ data }) => this.setData({ binary: (data instanceof ArrayBuffer) + ' ' + Array.from(new Uint8Array(data)).join(',') }),
      fail: err => this.setData({ binary: err.errMsg })
    });
    fs.readFile({
      filePath: 'assets/hello.txt',
      encoding: 'utf8',
      success: ({ data }) => this.setData({ text: data }),
      fail: err => this.setData({ text: err.errMsg })
    });
  }
});
`;

describe.skipIf(!e2eReady)('音频与视频', () => {
  let runner: Runner;
  // 业务的音视频服务器：和小程序不同源，也不带 CORS 响应头
  let server: http.Server;
  let serverUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const video = req.url === '/clip-2s.webm';
      const body = video ? CLIP : TONE;
      res.setHeader('content-type', video ? 'video/webm' : 'audio/wav');
      // 和 CDN 一样支持分段请求：不支持时浏览器认为视频不能跳转，seek 不起作用
      res.setHeader('accept-ranges', 'bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (!range) {
        res.end(body);
        return;
      }
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : body.length - 1;
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${body.length}` });
      res.end(body.subarray(start, end + 1));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    runner = await startRunner({
      'app.json': { pages: ['pages/audio/audio', 'pages/video/video', 'pages/file/file'] },
      'assets/tone.wav': TONE,
      'assets/tone-2s.wav': LONG_TONE,
      'assets/data.bin': Buffer.from([1, 2, 3, 255]),
      'assets/hello.txt': '你好，wxa-runner',
      'pages/audio/audio.json': {},
      'pages/audio/audio.wxml': AUDIO_WXML,
      'pages/audio/audio.js': AUDIO_JS,
      'pages/video/video.json': {},
      'pages/video/video.wxml': VIDEO_WXML,
      'pages/video/video.js': VIDEO_JS,
      'pages/file/file.json': {},
      'pages/file/file.wxml': FILE_WXML,
      'pages/file/file.js': FILE_JS
    });
  });

  afterAll(async () => {
    await runner?.close();
    server?.close();
  });

  const openAudio = (src: string) => runner.open(`/?path=pages/audio/audio&src=${encodeURIComponent(src)}`);

  it('用户点击播放网络地址的音频：依次收到 canplay、play、timeupdate 和 ended，时长与音频文件一致', async () => {
    const frame = await openAudio(`${serverUrl}/tone.wav`);
    await frame.click('#play');
    await expectText(frame, '#events', 'canplay,play,timeupdate,ended');
    await expectText(frame, '#duration', '1.0');
  });

  it('用户点击播放代码包里的音频文件，同样从加载播放到结束', async () => {
    const frame = await openAudio('/assets/tone.wav');
    await frame.click('#play');
    await expectText(frame, '#events', 'canplay,play,timeupdate,ended');
    await expectText(frame, '#duration', '1.0');
  });

  it('用户播放中跳转：跳转完成后继续收到 timeupdate，播到结束', async () => {
    const frame = await openAudio('/assets/tone-2s.wav');
    await frame.click('#play-seek');
    await expectText(frame, '#after-seek', 'continued');
    await expectText(frame, '#seek-ended', 'ended');
  });

  it('用户点击播放视频，开始播放就跳到 1.5 秒：跳过中间的内容播到结束，依次收到 play、timeupdate 和 ended', async () => {
    const frame = await runner.open(`/?path=pages/video/video&src=${encodeURIComponent(`${serverUrl}/clip-2s.webm`)}`);
    await expectText(frame, '#ready', 'yes');
    await frame.click('#play');
    await expectText(frame, '#events', 'play,timeupdate,ended');

    // 不跳转时每 0.25 秒左右报告一次位置，0.5 到 1.5 秒之间会报告好几次
    const positions = (await frame.textContent('#positions'))!.split(',').map(Number);
    expect(positions.filter(position => position > 0.5 && position < 1.5)).toEqual([]);
    expect(Math.max(...positions)).toBeGreaterThanOrEqual(1.5);
  });

  it('业务代码读取代码包里的文件：不指定编码得到 ArrayBuffer，指定 utf8 得到文本', async () => {
    const frame = await runner.open('/?path=pages/file/file');
    await frame.click('#read');
    await expectText(frame, '#binary', 'true 1,2,3,255');
    await expectText(frame, '#text', '你好，wxa-runner');
    expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
  });
});
