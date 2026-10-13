/**
 * 生成基础库读取的 __wxConfig，字段与开发者工具保持一致
 */

import { AppJson, UnitJson } from './MiniProgram';

export const DEFAULT_WINDOW = {
  navigationBarBackgroundColor: '#000000',
  navigationBarTextStyle: 'white',
  navigationBarTitleText: '',
  backgroundColor: '#ffffff',
  backgroundTextStyle: 'dark',
  enablePullDownRefresh: false,
  onReachBottomDistance: 50
};

export interface WxConfigInput {
  app: AppJson;
  pages: string[];
  unitJson: Map<string, UnitJson>;
  appid: string;
  subPackages: NonNullable<AppJson['subPackages']>;
}

export function createWxConfig(input: WxConfigInput): Record<string, any> {
  const { app, pages, unitJson, appid } = input;
  const entryPage = app.entryPagePath || app.pages[0];

  const page: Record<string, any> = {};
  for (const id of pages) {
    const { singlePage, ...window } = unitJson.get(id) || { usingComponents: {} };
    page[id + '.html'] = { window, singlePage, renderer: window.renderer };
  }

  const tabBar = app.tabBar
    ? { ...app.tabBar, list: app.tabBar.list.map(item => ({ ...item, pagePath: item.pagePath + '.html' })) }
    : undefined;

  return {
    ...app,
    pages: app.pages,
    resizable: !!app.resizable,
    subPackages: input.subPackages.length ? input.subPackages : undefined,
    debug: !!app.debug,
    widgets: app.widgets || [],
    customClose: !!app.customClose,
    workers: app.workers || '',
    cloud: !!app.cloud,
    global: { window: { ...DEFAULT_WINDOW, ...app.window } },
    page,
    networkTimeout: { request: 60000, uploadFile: 60000, connectSocket: 60000, downloadFile: 60000, ...app.networkTimeout },
    ext: app.ext || {},
    extAppid: app.extAppid || '',
    plugins: app.plugins || {},
    mainPlugins: { ...app.plugins },
    useExtendedLib: app.useExtendedLib || {},
    requiredPrivateInfos: app.requiredPrivateInfos || [],
    __warning__: '',
    entryPagePath: entryPage + '.html',
    tabBar,
    isLazyLoad: false,
    lazyCodeLoading: undefined,
    // 以下字段由开发者工具在运行时注入
    appname: appid,
    accountInfo: { appId: appid, icon: '', nickname: appid },
    appLaunchInfo: { scene: 1001, path: entryPage, query: {} },
    envVersion: 'develop',
    platform: 'devtools',
    env: { USER_DATA_PATH: 'http://usr' },
    isPluginMiniProgram: false,
    wxAppInfo: { maxRequestConcurrent: 10, maxUploadConcurrent: 10, maxDownloadConcurrent: 10, maxWebsocketConnect: 5 },
    deviceinfo: {}
  };
}
