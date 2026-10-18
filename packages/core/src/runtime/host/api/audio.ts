/**
 * 原生音频接口：基础库 3.3.x 及更早版本的 InnerAudioContext 调这些接口播放，宿主用 <audio> 实现
 *
 * 3.5.8 起平台是 devtools 时基础库改用 Web Audio，不再调这些接口（下载音频见 network.ts 的 isAudioDownload）。
 * 与基础库的约定：时间都以毫秒为单位；基础库每次改属性都带上全部状态调 setAudioState；
 * timeupdate 由基础库轮询 getAudioState 自己产生，这里只推送 onAudioStateChange。
 */

import { ApiHandler, fail, ok } from './registry';

export interface AudioApiOptions {
  /** 向逻辑层派发事件 */
  emit: (event: string, data: Record<string, unknown>) => void;
  createAudio?: () => HTMLAudioElement;
}

interface AudioInstance {
  audio: HTMLAudioElement;
  /** 基础库设置的 src。audio.src 是浏览器解析后的完整地址，比较不出有没有变 */
  src: string;
  /** 毫秒，还没播放过时从这里开始 */
  startTime: number;
  played: boolean;
  /** stop 之后到下一次播放、跳转或换 src 之前：stop 把进度归零引起的 seeking、seeked 等不转给基础库 */
  stopped: boolean;
  report: (state: string, extra?: Record<string, unknown>) => void;
  destroy: () => void;
}

/**
 * 浏览器事件 → 基础库的状态。play 用 playing：缓冲（waiting）后浏览器只派发 playing，
 * 基础库收到 waiting 就当作暂停、停止轮询进度，要再收到 play 才恢复
 */
const STATES: Record<string, string> = {
  canplay: 'canplay',
  playing: 'play',
  ended: 'ended',
  waiting: 'waiting',
  seeking: 'seeking',
  seeked: 'seeked'
};

/** HTMLMediaElement.HAVE_METADATA，单元测试的 Node 环境里没有 HTMLMediaElement */
const HAVE_METADATA = 1;

/** MediaError.code → 基础库的 errCode：10002 网络错误，10004 格式错误，其余为 -1 未知错误 */
const ERROR_CODES: Record<number, number> = { 2: 10002, 3: 10004, 4: 10004 };

let audioSeq = 0;

export function createAudioApis(options: AudioApiOptions): Record<string, ApiHandler> {
  const { emit, createAudio = () => new Audio() } = options;
  const instances = new Map<number, AudioInstance>();

  const createAudioInstance: ApiHandler = (_args, { api }) => {
    const audioId = ++audioSeq;
    const audio = createAudio();
    const listening = new AbortController();
    const instance: AudioInstance = {
      audio,
      src: '',
      startTime: 0,
      played: false,
      stopped: false,
      report: (state, extra) => emit('onAudioStateChange', { audioId, state, ...extra }),
      destroy: () => {
        listening.abort();
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
    const on = (type: string, listener: () => void) => audio.addEventListener(type, listener, { signal: listening.signal });

    for (const [type, state] of Object.entries(STATES)) {
      on(type, () => {
        if (!instance.stopped) instance.report(state);
      });
    }
    on('loadedmetadata', () => {
      if (!instance.played && instance.startTime > 0) audio.currentTime = instance.startTime / 1000;
    });
    on('error', () => {
      const code = audio.error?.code ?? 0;
      instance.report('error', { errCode: ERROR_CODES[code] ?? -1, errMsg: audio.error?.message || `MediaError ${code}` });
    });

    instances.set(audioId, instance);
    return ok(api, { audioId });
  };

  /** @returns 找不到时为失败结果 */
  const withInstance = (args: any, api: string, action: (instance: AudioInstance) => Record<string, unknown> | void) => {
    const instance = instances.get(args.audioId);
    return instance ? ok(api, action(instance) || {}) : fail(api, `audio instance ${args.audioId} not found`);
  };

  return {
    createAudioInstance,
    createAudioInstanceAsync: createAudioInstance,

    // 状态里的 paused、currentTime 等是基础库缓存的旧值，只取能设置的属性
    setAudioState: (args, { api }) => withInstance(args, api, instance => {
      const { audio } = instance;
      if (typeof args.autoplay === 'boolean') audio.autoplay = args.autoplay;
      if (typeof args.loop === 'boolean') audio.loop = args.loop;
      if (typeof args.volume === 'number') audio.volume = args.volume;
      if (typeof args.playbackRate === 'number') audio.playbackRate = args.playbackRate;
      // 重新赋值 src 会从头加载
      if (typeof args.src === 'string' && args.src !== instance.src) {
        Object.assign(instance, { src: args.src, played: false, stopped: false });
        audio.src = args.src;
      }
      // 和基础库的 Web Audio 实现一致：还没播放过时立即跳过去，没加载好的等 loadedmetadata
      if (typeof args.startTime === 'number' && args.startTime !== instance.startTime) {
        instance.startTime = args.startTime;
        if (!instance.played && audio.readyState >= HAVE_METADATA) audio.currentTime = args.startTime / 1000;
      }
    }),

    getAudioState: (args, { api }) => withInstance(args, api, ({ audio, src, startTime }) => ({
      src,
      startTime,
      paused: audio.paused,
      currentTime: Math.round(audio.currentTime * 1000),
      duration: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0,
      buffered: audio.buffered.length ? Math.round(audio.buffered.end(audio.buffered.length - 1) * 1000) : 0,
      volume: audio.volume,
      autoplay: audio.autoplay,
      loop: audio.loop,
      playbackRate: audio.playbackRate
    })),

    operateAudio: (args, { api }) => withInstance(args, api, instance => {
      const { audio } = instance;
      switch (args.operationType) {
        case 'play':
          Object.assign(instance, { played: true, stopped: false });
          // 被随后的 pause 打断（AbortError）不算错；音频本身加载失败由 error 事件报告
          audio.play().catch((error: DOMException) => {
            if (error.name === 'NotAllowedError') instance.report('error', { errCode: -1, errMsg: `${error.name}: ${error.message}` });
          });
          break;
        // 浏览器的 pause 事件不转发：它在 stop 之后才异步派发，播到结尾时也会先派发一次
        case 'pause':
          if (!audio.paused) instance.report('pause');
          audio.pause();
          break;
        case 'stop':
          instance.stopped = true;
          audio.pause();
          audio.currentTime = 0;
          instance.report('stop');
          break;
        case 'seek':
          instance.stopped = false;
          audio.currentTime = Number(args.currentTime) / 1000;
          break;
        default:
          throw new Error(`unknown operationType ${args.operationType}`);
      }
    }),

    destroyAudioInstance: (args, { api }) => {
      instances.get(args.audioId)?.destroy();
      instances.delete(args.audioId);
      return ok(api);
    }
  };
}
