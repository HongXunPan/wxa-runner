/**
 * 原生音频接口：基础库 3.3.x 及更早版本的 InnerAudioContext 不用 Web Audio，调原生接口播放
 *
 * 用假的 <audio> 元素固定住与基础库的约定：时间都以毫秒为单位；基础库每次改属性都带上全部状态调 setAudioState；
 * timeupdate 由基础库轮询 getAudioState 自己产生，原生只推送 onAudioStateChange。
 * 真实基础库上的表现用 WXA_BASELIB=3.3.4 pnpm test 覆盖（tests/e2e/audioVideo.test.ts）。
 */

import { describe, expect, it } from 'vitest';
import { createAudioApis } from '../../packages/core/src/runtime/host/api/audio';

/** 浏览器 <audio> 的替身：浏览器在加载、播放过程中派发的事件由测试按需触发 */
class FakeAudio extends EventTarget {
  loads = 0;
  autoplay = false;
  loop = false;
  volume = 1;
  playbackRate = 1;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  buffered = { length: 0, end: () => 0 };
  error: { code: number; message: string } | null = null;
  playResult: Promise<void> = Promise.resolve();
  private source = '';

  get src() {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    this.loads++;
    this.currentTime = 0;
  }

  /** 和浏览器一样先派发 play，数据够了再派发 playing */
  play() {
    this.paused = false;
    this.ended = false;
    this.fire('play');
    this.fire('playing');
    return this.playResult;
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.fire('pause');
  }

  load() {}

  removeAttribute(name: string) {
    if (name === 'src') this.source = '';
  }

  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }

  /** 浏览器加载好了音频 */
  loaded(duration: number) {
    this.duration = duration;
    this.fire('loadedmetadata');
    this.fire('canplay');
  }

  /** 和浏览器一样，播到结尾时先派发 pause 再派发 ended */
  finish() {
    this.currentTime = this.duration;
    this.paused = true;
    this.ended = true;
    this.fire('pause');
    this.fire('ended');
  }
}

// 基础库调 setAudioState 时带上的全部状态，取自 3.3.4 的 InnerAudioContext
const STATE = { src: '', startTime: 0, paused: true, currentTime: 0, duration: 0, obeyMuteSwitch: true, volume: 1, autoplay: false, loop: false };

function setup() {
  const events: Array<Record<string, any>> = [];
  const audios: FakeAudio[] = [];
  const apis = createAudioApis({
    emit: (event, data) => {
      if (event === 'onAudioStateChange') events.push(data);
    },
    createAudio: () => {
      const audio = new FakeAudio();
      audios.push(audio);
      return audio as unknown as HTMLAudioElement;
    }
  });
  const call = (api: string, args: object = {}) => apis[api](args, { api, from: 'service', webviewId: 1 }) as any;
  const states = () => events.map(event => event.state);

  /** 基础库创建音频、设置好 src 等状态，浏览器加载好了 */
  const createLoaded = (state: Record<string, unknown> = {}, duration = 2) => {
    const { audioId } = call('createAudioInstance', { timestamp: 1 });
    call('setAudioState', { ...STATE, audioId, src: '/assets/tone.wav', ...state });
    const audio = audios.at(-1)!;
    audio.loaded(duration);
    return { audioId, audio };
  };

  return { call, events, states, createLoaded };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('原生音频接口', () => {
  it('基础库创建音频、设置 src 后播放：依次收到 canplay、play，getAudioState 以毫秒给出时长和进度', () => {
    const { call, events, states, createLoaded } = setup();
    const { audioId, audio } = createLoaded({}, 1.5);

    call('operateAudio', { audioId, operationType: 'play' });
    audio.currentTime = 0.25;

    expect(audio.src).toBe('/assets/tone.wav');
    expect(states()).toEqual(['canplay', 'play']);
    expect(events.every(event => event.audioId === audioId)).toBe(true);
    expect(call('getAudioState', { audioId })).toMatchObject({
      errMsg: 'getAudioState:ok', src: '/assets/tone.wav', paused: false, duration: 1500, currentTime: 250
    });
  });

  it('基础库每次改属性都带上全部状态：src 没变时不重新加载，进度不被状态里的旧值覆盖', () => {
    const { call, createLoaded } = setup();
    const { audioId, audio } = createLoaded();
    call('operateAudio', { audioId, operationType: 'play' });
    audio.currentTime = 1;

    // 改音量，状态里的 currentTime 是基础库缓存的旧值
    call('setAudioState', { ...STATE, audioId, src: '/assets/tone.wav', volume: 0.5, currentTime: 0 });

    expect(audio.loads).toBe(1);
    expect(audio.volume).toBe(0.5);
    expect(call('getAudioState', { audioId }).currentTime).toBe(1000);
  });

  it('设置了 startTime（毫秒）时，加载好后从这个位置开始', () => {
    const { call, createLoaded } = setup();
    const { audioId } = createLoaded({ startTime: 800 });
    expect(call('getAudioState', { audioId })).toMatchObject({ startTime: 800, currentTime: 800 });
  });

  it('播到结尾只推送 ended，不推送 pause；stop 推送 stop 并回到开头', () => {
    const { call, states, createLoaded } = setup();
    const { audioId, audio } = createLoaded();

    call('operateAudio', { audioId, operationType: 'play' });
    audio.finish();
    expect(states()).toEqual(['canplay', 'play', 'ended']);

    call('operateAudio', { audioId, operationType: 'play' });
    audio.currentTime = 1;
    call('operateAudio', { audioId, operationType: 'stop' });
    expect(states()).toEqual(['canplay', 'play', 'ended', 'play', 'stop']);
    expect(call('getAudioState', { audioId })).toMatchObject({ paused: true, currentTime: 0 });
  });

  it('pause 推送 pause；seek 的位置以毫秒为单位；浏览器的 waiting、seeking、seeked 原样转给基础库', () => {
    const { call, states, createLoaded } = setup();
    const { audioId, audio } = createLoaded();
    call('operateAudio', { audioId, operationType: 'play' });

    call('operateAudio', { audioId, operationType: 'seek', currentTime: 1500 });
    audio.fire('seeking');
    audio.fire('seeked');
    audio.fire('waiting');
    call('operateAudio', { audioId, operationType: 'pause' });

    expect(call('getAudioState', { audioId }).currentTime).toBe(1500);
    expect(states()).toEqual(['canplay', 'play', 'seeking', 'seeked', 'waiting', 'pause']);
  });

  it('加载失败时推送 error，网络错误的 errCode 为 10002；浏览器拒绝播放时同样推送 error', async () => {
    const { call, events, createLoaded } = setup();
    const { audioId, audio } = createLoaded();

    audio.error = { code: 2, message: 'net::ERR_CONNECTION_REFUSED' };
    audio.fire('error');
    audio.playResult = Promise.reject(new DOMException('play() failed because the user didn\'t interact', 'NotAllowedError'));
    call('operateAudio', { audioId, operationType: 'play' });
    await flush();

    expect(events.filter(event => event.state === 'error')).toEqual([
      { audioId, state: 'error', errCode: 10002, errMsg: expect.stringContaining('net::ERR_CONNECTION_REFUSED') },
      { audioId, state: 'error', errCode: -1, errMsg: expect.stringContaining('NotAllowedError') }
    ]);
  });

  it('销毁后停止播放、不再推送事件，再操作这个音频时失败', () => {
    const { call, states, createLoaded } = setup();
    const { audioId, audio } = createLoaded();
    call('operateAudio', { audioId, operationType: 'play' });

    call('destroyAudioInstance', { audioId });
    audio.fire('ended');

    expect(audio.paused).toBe(true);
    expect(states()).toEqual(['canplay', 'play']);
    expect(call('getAudioState', { audioId }).errMsg).toMatch(/^getAudioState:fail /);
    expect(call('operateAudio', { audioId, operationType: 'play' }).errMsg).toMatch(/^operateAudio:fail /);
  });
});
