/**
 * 不依赖 DOM 的原生 API 实现
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMiscApis } from '../../packages/core/src/runtime/host/api/misc';
import { createNetworkApis } from '../../packages/core/src/runtime/host/api/network';
import { ApiHandler, ApiRegistry } from '../../packages/core/src/runtime/host/api/registry';
import { createSystemApis } from '../../packages/core/src/runtime/host/api/system';
import { createUiApis } from '../../packages/core/src/runtime/host/api/ui';
import type { PhoneShell } from '../../packages/core/src/runtime/host/ui/PhoneShell';

const device = {
  model: 'iPhone 6/7/8', screenWidth: 375, screenHeight: 667, pixelRatio: 2,
  statusBarHeight: 20, safeAreaBottom: 0, system: 'iOS 16.0', platform: 'devtools'
};

const call = (apis: Record<string, ApiHandler>, api: string, args: object = {}) =>
  apis[api](args, { api, from: 'service', webviewId: 1 }) as any;

describe('系统信息', () => {
  const apis = createSystemApis({ device, baseLibVersion: '3.7.0', windowHeight: () => 553, screenTop: () => 64 });

  it('getSystemInfo 合并设备、窗口和基础库信息', () => {
    expect(call(apis, 'getSystemInfoSync')).toMatchObject({
      model: 'iPhone 6/7/8', screenWidth: 375, windowWidth: 375, windowHeight: 553,
      statusBarHeight: 20, SDKVersion: '3.7.0', platform: 'devtools', errMsg: 'getSystemInfoSync:ok'
    });
  });

  it('带 type 参数时只返回对应部分（基础库的 getWindowInfo 等走这条路）', () => {
    const windowInfo = call(apis, 'getSystemInfo', { type: 'windowInfo' });
    expect(windowInfo).toMatchObject({ windowHeight: 553, pixelRatio: 2 });
    expect(windowInfo.model).toBeUndefined();
    expect(call(apis, 'getSystemInfo', { type: 'appBaseInfo' })).toMatchObject({ SDKVersion: '3.7.0' });
  });

  it('刘海屏的安全区扣除状态栏和底部 Home Indicator', () => {
    const iphoneX = { ...device, model: 'iPhone X', screenHeight: 812, pixelRatio: 3, statusBarHeight: 44, safeAreaBottom: 34 };
    const xApis = createSystemApis({ device: iphoneX, baseLibVersion: '3.7.0', windowHeight: () => 812, screenTop: () => 0 });
    expect(call(xApis, 'getWindowInfo')).toMatchObject({
      screenWidth: 375, screenHeight: 812, windowWidth: 375, windowHeight: 812,
      windowTop: 0, windowBottom: 0, screenTop: 0, pixelRatio: 3, statusBarHeight: 44,
      safeArea: { top: 44, left: 0, right: 375, bottom: 778, width: 375, height: 734 },
      safeAreaInsets: { top: 44, left: 0, right: 0, bottom: 34 }
    });
  });

  it('胶囊按钮位置按状态栏高度计算', () => {
    expect(call(apis, 'getMenuButtonBoundingClientRect')).toMatchObject({ top: 26, right: 368, width: 87, height: 32 });
  });
});

describe('界面 API', () => {
  const shell = {
    showToast: vi.fn(),
    hideToast: vi.fn(),
    showModal: vi.fn(async () => ({ confirm: true, cancel: false })),
    showActionSheet: vi.fn(async () => null as number | null),
    setNavigationLoading: vi.fn()
  };
  const updateNavigation = vi.fn();
  const apis = createUiApis({ shell: shell as unknown as PhoneShell, updateNavigation });

  it('showLoading 是不会自动消失的 loading toast', () => {
    call(apis, 'showLoading', { title: '加载中' });
    expect(shell.showToast).toHaveBeenCalledWith({ title: '加载中', icon: 'loading', duration: 0 });
  });

  it('showModal 等待用户选择后返回结果', async () => {
    await expect(call(apis, 'showModal', { title: 't' })).resolves.toEqual({ confirm: true, cancel: false, errMsg: 'showModal:ok' });
  });

  it('取消 actionSheet 返回 fail cancel', async () => {
    await expect(call(apis, 'showActionSheet', { itemList: ['a'] })).resolves.toEqual({ errMsg: 'showActionSheet:fail cancel' });
    shell.showActionSheet.mockResolvedValueOnce(1);
    await expect(call(apis, 'showActionSheet', { itemList: ['a', 'b'] })).resolves.toMatchObject({ tapIndex: 1 });
  });

  it('导航栏颜色：frontColor 换算为文字样式', () => {
    call(apis, 'setNavigationBarColor', { frontColor: '#000000', backgroundColor: '#ffffff' });
    expect(updateNavigation).toHaveBeenLastCalledWith({ backgroundColor: '#ffffff', textStyle: 'black' });
    call(apis, 'setNavigationBarTitle', { title: '新标题' });
    expect(updateNavigation).toHaveBeenLastCalledWith({ title: '新标题' });
  });
});

describe('网络 API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  function setup(response: () => Promise<Response>) {
    const events: Array<[string, any]> = [];
    const fetchMock = vi.fn(async (..._args: unknown[]) => response());
    vi.stubGlobal('fetch', fetchMock);
    const apis = createNetworkApis({ emit: (event, data) => events.push([event, data]), defaultTimeout: () => 60000 });
    return { apis, events, fetchMock };
  }

  const proxied = (body: string, status = 200, header: object = { 'content-type': 'text/plain' }) => async () =>
    new Response(body, {
      status,
      headers: {
        'x-wxa-headers': encodeURIComponent(JSON.stringify(header)),
        'x-wxa-set-cookie': encodeURIComponent(JSON.stringify(['a=1']))
      }
    });

  it('同步返回 requestTaskId，随后依次推送 headersReceived 和 success', async () => {
    const { apis, events, fetchMock } = setup(proxied('{"ok":1}', 201));
    const result = call(apis, 'createRequestTask', { url: 'https://api.example.com/x?y=1', method: 'post', data: 'a=1', header: { cookie: 'c=1' } });
    expect(result.errMsg).toBe('createRequestTask:ok');
    expect(events).toEqual([]);

    await vi.waitFor(() => expect(events.length).toBe(2));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__wxa__/proxy?url=' + encodeURIComponent('https://api.example.com/x?y=1'));
    expect(init.method).toBe('POST');
    expect(init.body).toBe('a=1');
    expect(JSON.parse((init.headers as Record<string, string>)['x-wxa-headers'])).toEqual({ cookie: 'c=1' });

    expect(events[0]).toEqual(['onRequestTaskStateChange', expect.objectContaining({ state: 'headersReceived', statusCode: 201, cookies: ['a=1'] })]);
    expect(events[1]).toEqual(['onRequestTaskStateChange', expect.objectContaining({
      requestTaskId: result.requestTaskId, state: 'success', data: '{"ok":1}', statusCode: 201, header: { 'content-type': 'text/plain' }
    })]);
  });

  it('GET 请求不带请求体', async () => {
    const { apis, fetchMock } = setup(proxied(''));
    call(apis, 'createRequestTask', { url: 'https://a.com', data: 'ignored' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBeUndefined();
  });

  it('代理报错或地址非法时推送 fail', async () => {
    const { apis, events } = setup(async () => new Response('ECONNREFUSED', { status: 502, headers: { 'x-wxa-proxy-error': '1' } }));
    call(apis, 'createRequestTask', { url: 'https://down.example.com' });
    call(apis, 'createRequestTask', { url: 'relative/path' });
    await vi.waitFor(() => expect(events.length).toBe(2));
    expect(events.map(([, data]) => data.errMsg).sort()).toEqual([
      'request:fail ECONNREFUSED',
      'request:fail invalid url "relative/path"'
    ]);
  });

  it('abort 后推送 request:fail abort', async () => {
    const { apis, events } = setup(() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 20);
    }));
    const { requestTaskId } = call(apis, 'createRequestTask', { url: 'https://slow.example.com' });
    await flush();
    call(apis, 'operateRequestTask', { requestTaskId, operationType: 'abort' });
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(events[0][1]).toMatchObject({ state: 'fail' });
  });

  it('基础库自己的网络请求（数据上报等）不发往网络、不记入请求记录，直接失败', async () => {
    const recorded: unknown[] = [];
    const fetchMock = vi.fn();
    const socketMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', socketMock);
    const apis = createNetworkApis({ emit: () => undefined, defaultTimeout: () => 60000, onRequest: request => recorded.push(request) });

    // 基础库通过 _requestSkipCheckDomain 等内部接口发出，带 __skipDomainCheck__ 标记
    const internal = { url: 'https://report-online.sh.wxgateway.com/SdkReport', method: 'POST', __skipDomainCheck__: true };
    const results = ['createRequestTask', 'createDownloadTask', 'createUploadTask', 'createSocketTask'].map(api => call(apis, api, internal).errMsg);
    await flush();

    expect(results).toEqual([
      expect.stringMatching(/^createRequestTask:fail/),
      expect.stringMatching(/^createDownloadTask:fail/),
      expect.stringMatching(/^createUploadTask:fail/),
      expect.stringMatching(/^createSocketTask:fail/)
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(socketMock).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('downloadFile 把下载的文件存成开发服务器上的临时文件，返回它的地址', async () => {
    const saved: Array<{ url: string; content: string }> = [];
    const { apis, events } = setup(proxied('file-content'));
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!url.startsWith('/__wxa__/tmp')) return proxied('file-content')();
      saved.push({ url, content: await (init!.body as Blob).text() });
      return Response.json({ url: 'http://localhost:3000/__wxa__/tmp/saved.png' });
    });

    const { downloadTaskId } = call(apis, 'createDownloadTask', { url: 'https://cdn.example.com/a.png?v=2' });

    await vi.waitFor(() => expect(events.some(([, d]) => d.state === 'success')).toBe(true));
    expect(saved).toEqual([{ url: '/__wxa__/tmp?type=png', content: 'file-content' }]);
    expect(events.at(-1)).toEqual(['onDownloadTaskStateChange', expect.objectContaining({
      downloadTaskId, state: 'success', tempFilePath: 'http://localhost:3000/__wxa__/tmp/saved.png', statusCode: 200
    })]);
  });
});

describe('其它 API', () => {
  const apis = createMiscApis('wx1');

  it('文件系统 API 与基础库的调用格式一致', () => {
    expect(call(apis, 'access', { path: 'http://usr/x' }).errMsg).toMatch(/^access:fail no such file/);
    expect(call(apis, 'mkdir', { dirPath: 'http://usr/logs', recursive: true }).errMsg).toBe('mkdir:ok');
    call(apis, 'writeFile', { filePath: 'http://usr/logs/1.log', data: 'hello' });
    expect(call(apis, 'readFileSync', { filePath: 'http://usr/logs/1.log' })).toMatchObject({ data: 'hello' });
    expect(call(apis, 'stat', { path: 'http://usr/logs/1.log' }).stats).toMatchObject({ size: 5 });
    expect(call(apis, 'readdir', { dirPath: 'http://usr/logs' }).files).toEqual(['1.log']);
  });

  it('不校验业务域名：基础库不论从哪个原生接口拉业务域名列表都明确失败，拉别的照常成功', () => {
    expect(call(apis, 'operateWXData', { data: { api_name: 'webapi_getwxanetwork' } }).errMsg).toMatch(/^operateWXData:fail /);
    expect(call(apis, 'getAppContact', { keyPath: 'WxaAppInfo.Network.BizDomain' }).errMsg).toMatch(/^getAppContact:fail /);
    expect(call(apis, 'operateWXData', { data: { api_name: 'webapi_getwxabusinessconfig' } }).errMsg).toBe('operateWXData:ok');
    expect(call(apis, 'getAppContact', { keyPath: 'WxaAppInfo.Name' }).errMsg).toBe('getAppContact:ok');
  });

  it('开放接口返回可预测的模拟数据，支付明确失败', () => {
    expect(call(apis, 'login').code).toMatch(/^wxa_mock_code_/);
    expect(phoneCodeSeenByBaseLib(call(apis, 'getPhoneNumber'))).toMatch(/^mock_phone_code_/);
    expect(call(apis, 'getAccountInfoSync').miniProgram.appId).toBe('wx1');
    expect(call(apis, 'requestPayment').errMsg).toMatch(/^requestPayment:fail /);
  });
});

/** 基础库（WAWebview 的 getPhoneNumber）只从 JSON.parse(data) 里取 code，顶层的 code 会被丢掉 */
function phoneCodeSeenByBaseLib(result: { data?: string }): string | undefined {
  return result.data ? JSON.parse(result.data).code : undefined;
}

describe('真实登录（--real-login）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function invoke(api: string, response: Response) {
    const fetchMock = vi.fn(async (..._args: unknown[]) => response);
    vi.stubGlobal('fetch', fetchMock);
    const onRealLoginFail = vi.fn();
    const registry = new ApiRegistry();
    registry.register(createMiscApis('wx1', { realLogin: true, onRealLoginFail }));
    return { result: registry.invoke(api, {}, { api, from: 'service', webviewId: 1 }), fetchMock, onRealLoginFail };
  }

  const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

  it('wx.login 返回开发服务器向微信换来的 code', async () => {
    const { result, fetchMock } = invoke('login', json({ code: 'real-code' }));
    expect(await result).toEqual({ code: 'real-code', errMsg: 'login:ok' });
    expect(fetchMock).toHaveBeenCalledWith('/__wxa__/api/login', { method: 'POST' });
  });

  it('getPhoneNumber 的 code 能被基础库取到', async () => {
    const data = JSON.stringify({ data: '{"mobile":"138****1997"}', encryptedData: 'enc', iv: 'iv', code: 'phone-code' });
    const { result } = invoke('getPhoneNumber', json({ data, encryptedData: 'enc', iv: 'iv' }));
    const phone = await result;
    expect(phone).toMatchObject({ encryptedData: 'enc', iv: 'iv', errMsg: 'getPhoneNumber:ok' });
    expect(phoneCodeSeenByBaseLib(phone)).toBe('phone-code');
  });

  it('开发服务器给出的失败原因原样作为 fail 消息，不退回模拟数据', async () => {
    const { result } = invoke('login', json({ error: '微信开发者工具的登录态已过期' }, 500));
    expect(await result).toEqual({ errMsg: 'login:fail 微信开发者工具的登录态已过期' });
  });

  it('失败时把 API 名称和原因交给宿主页面提示开发者，成功时不提示', async () => {
    const failed = invoke('getPhoneNumber', json({ error: '微信开发者工具的登录态已过期' }, 500));
    await failed.result;
    expect(failed.onRealLoginFail).toHaveBeenCalledWith('getPhoneNumber', '微信开发者工具的登录态已过期');

    const succeeded = invoke('login', json({ code: 'real-code' }));
    await succeeded.result;
    expect(succeeded.onRealLoginFail).not.toHaveBeenCalled();
  });

  it('响应不是 JSON 时（如代理返回的错误页）fail 消息带上状态码', async () => {
    const { result } = invoke('getPhoneNumber', new Response('<!DOCTYPE html>', { status: 502 }));
    expect(await result).toEqual({ errMsg: 'getPhoneNumber:fail 开发服务器返回 HTTP 502' });
  });
});
