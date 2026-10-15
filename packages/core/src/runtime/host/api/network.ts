/**
 * 网络 API：wx.request / downloadFile / uploadFile / connectSocket
 *
 * 基础库 3.x 的协议是「创建任务同步返回 taskId，结果通过 on<Type>TaskStateChange 事件推送」。
 * HTTP 请求经开发服务器的 /__wxa__/proxy 转发：既绕开 CORS，也能携带浏览器禁止设置的
 * cookie / referer 等请求头。
 */

import type { MockRequest } from '../../../setup';
import { ApiHandler, fail, ok } from './registry';
import type { RequestRoutes } from './routes';
import { saveTempFile, tempFileType } from './tempFiles';

export interface NetworkApiOptions {
  /** 向逻辑层派发事件 */
  emit: (event: string, data: Record<string, unknown>) => void;
  defaultTimeout: () => number;
  /** 请求拦截，只作用于 wx.request */
  routes?: RequestRoutes;
  /** wx.request 发出时调用，早于拦截和转发 */
  onRequest?: (request: RecordedRequest) => void;
}

/** 小程序发出的一个 wx.request */
export interface RecordedRequest extends MockRequest {
  /** 拦截它的规则（setup 的 network.routes 或测试 API 的 route），经代理发往网络时为 null */
  routedBy: string | null;
}

interface ProxyResponse {
  statusCode: number;
  header: Record<string, string>;
  cookies: string[];
  response: Response;
}

let taskSeq = 0;

export function createNetworkApis(options: NetworkApiOptions): Record<string, ApiHandler> {
  const controllers = new Map<string, AbortController>();
  const sockets = new Map<string, WebSocket>();
  const { emit } = options;

  const startTask = (args: any, run: (signal: AbortSignal, id: string) => Promise<void>): string => {
    const id = String(++taskSeq);
    const controller = new AbortController();
    const timeout = args.timeout || options.defaultTimeout();
    const timer = timeout > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeout) : null;
    controllers.set(id, controller);
    // 任务 id 先同步返回给基础库，结果事件之后再推送
    setTimeout(() => {
      run(controller.signal, id).finally(() => {
        if (timer) clearTimeout(timer);
        controllers.delete(id);
      });
    }, 0);
    return id;
  };

  const abortTask = (args: any, key: string) => {
    if (args.operationType === 'abort') controllers.get(String(args[key]))?.abort(new Error('abort'));
  };

  const createRequestTask: ApiHandler = (args, { api }) => {
    const request: MockRequest = { url: args.url, method: (args.method || 'GET').toUpperCase(), header: { ...args.header }, data: args.data };
    // 发出时就确定是否拦截：记录里能看到命中的规则，之后增删规则不影响已发出的请求
    const route = options.routes?.match(request);
    options.onRequest?.({ ...request, header: { ...request.header }, routedBy: route ? route.pattern : null });

    const requestTaskId = startTask(args, async (signal, id) => {
      try {
        const mocked = route && await route.respond(signal);
        const res = mocked
          ? { statusCode: mocked.statusCode, header: mocked.header, cookies: [] as string[], text: async () => mocked.data }
          : await proxyFetch(request.url, { method: request.method, header: args.header, body: args.data, signal })
            .then(proxied => ({ ...proxied, text: () => proxied.response.text() }));
        emit('onRequestTaskStateChange', {
          requestTaskId: id, state: 'headersReceived', header: res.header, statusCode: res.statusCode, cookies: res.cookies
        });
        const data = await res.text();
        emit('onRequestTaskStateChange', {
          requestTaskId: id, state: 'success', data, statusCode: res.statusCode, header: res.header, cookies: res.cookies, profile: {}
        });
      } catch (error) {
        emit('onRequestTaskStateChange', { requestTaskId: id, state: 'fail', errMsg: `request:fail ${reason(error)}` });
      }
    });
    return ok(api, { requestTaskId });
  };

  const createDownloadTask: ApiHandler = (args, { api }) => {
    const downloadTaskId = startTask(args, async (signal, id) => {
      try {
        const res = await proxyFetch(args.url, { method: 'GET', header: args.header, signal });
        emit('onDownloadTaskStateChange', { downloadTaskId: id, state: 'headersReceived', header: res.header, cookies: res.cookies });
        const blob = await res.response.blob();
        emit('onDownloadTaskStateChange', {
          downloadTaskId: id, state: 'progressUpdate', progress: 100, totalBytesWritten: blob.size, totalBytesExpectedToWrite: blob.size
        });
        // 不用 blob: 地址：image 组件会把它当成页面相对路径
        const fileName = new URL(args.url).pathname.split('/').pop() || '';
        const tempFilePath = await saveTempFile(blob, tempFileType(fileName, blob.type, 'tmp'));
        emit('onDownloadTaskStateChange', {
          downloadTaskId: id,
          state: 'success',
          tempFilePath,
          statusCode: res.statusCode,
          header: res.header,
          profile: {}
        });
      } catch (error) {
        emit('onDownloadTaskStateChange', { downloadTaskId: id, state: 'fail', errMsg: `downloadFile:fail ${reason(error)}` });
      }
    });
    return ok(api, { downloadTaskId });
  };

  const createUploadTask: ApiHandler = (args, { api }) => {
    const uploadTaskId = startTask(args, async (signal, id) => {
      try {
        const file = await (await fetch(args.filePath)).blob();
        const form = new FormData();
        for (const [key, value] of Object.entries(args.formData || {})) form.append(key, String(value));
        form.append(args.name || 'file', file, String(args.filePath).split('/').pop() || 'file');

        const res = await proxyFetch(args.url, { method: 'POST', header: args.header, body: form, signal });
        const data = await res.response.text();
        emit('onUploadTaskStateChange', {
          uploadTaskId: id, state: 'progressUpdate', progress: 100, totalBytesSent: file.size, totalBytesExpectedToSend: file.size
        });
        emit('onUploadTaskStateChange', { uploadTaskId: id, state: 'success', data, statusCode: res.statusCode, header: res.header });
      } catch (error) {
        emit('onUploadTaskStateChange', { uploadTaskId: id, state: 'fail', errMsg: `uploadFile:fail ${reason(error)}` });
      }
    });
    return ok(api, { uploadTaskId });
  };

  const createSocketTask: ApiHandler = (args, { api }) => {
    const socketTaskId = String(++taskSeq);
    let socket: WebSocket;
    try {
      socket = new WebSocket(args.url, args.protocols && args.protocols.length ? args.protocols : undefined);
    } catch (error) {
      return fail(api, reason(error));
    }
    socket.binaryType = 'arraybuffer';
    sockets.set(socketTaskId, socket);
    socket.onopen = () => emit('onSocketTaskStateChange', { socketTaskId, state: 'open', header: {}, profile: {} });
    socket.onmessage = event => emit('onSocketTaskStateChange', {
      socketTaskId, state: 'message', data: typeof event.data === 'string' ? event.data : '[binary message not supported]'
    });
    socket.onerror = () => emit('onSocketTaskStateChange', { socketTaskId, state: 'error', errMsg: 'connectSocket:fail' });
    socket.onclose = event => {
      sockets.delete(socketTaskId);
      emit('onSocketTaskStateChange', { socketTaskId, state: 'close', code: event.code, reason: event.reason });
    };
    return ok(api, { socketTaskId });
  };

  const operateSocketTask: ApiHandler = (args, { api }) => {
    const socket = sockets.get(String(args.socketTaskId));
    if (!socket) return fail(api, 'socket task not found');
    if (args.operationType === 'send') {
      if (socket.readyState !== WebSocket.OPEN) return fail(api, 'socket is not open');
      socket.send(args.data);
    } else if (args.operationType === 'close') {
      socket.close(args.code || 1000, args.reason);
    }
    return ok(api);
  };

  return {
    createRequestTask,
    createRequestTaskAsync: createRequestTask,
    operateRequestTask: args => abortTask(args, 'requestTaskId'),
    createDownloadTask,
    createDownloadTaskAsync: createDownloadTask,
    operateDownloadTask: args => abortTask(args, 'downloadTaskId'),
    createUploadTask,
    createUploadTaskAsync: createUploadTask,
    operateUploadTask: args => abortTask(args, 'uploadTaskId'),
    createSocketTask,
    operateSocketTask
  };
}

export async function proxyFetch(
  url: string,
  init: { method: string; header?: Record<string, string>; body?: unknown; signal?: AbortSignal }
): Promise<ProxyResponse> {
  if (!/^https?:\/\//i.test(url)) throw new Error(`invalid url "${url}"`);

  const hasBody = init.body !== undefined && init.body !== '' && !['GET', 'HEAD'].includes(init.method);
  const response = await fetch(`/__wxa__/proxy?url=${encodeURIComponent(url)}`, {
    method: init.method,
    headers: { 'x-wxa-headers': JSON.stringify(init.header || {}) },
    body: hasBody ? init.body as BodyInit : undefined,
    signal: init.signal
  });

  if (response.headers.get('x-wxa-proxy-error')) {
    throw new Error(await response.text());
  }

  return {
    statusCode: response.status,
    header: JSON.parse(decodeURIComponent(response.headers.get('x-wxa-headers') || '%7B%7D')),
    cookies: JSON.parse(decodeURIComponent(response.headers.get('x-wxa-set-cookie') || '%5B%5D')),
    response
  };
}

function reason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'abort';
  return error instanceof Error ? error.message : String(error);
}
