/**
 * 设备与系统信息：以模拟设备为准，而不是宿主浏览器窗口
 */

import type { DeviceProfile } from '../../types';
import { ApiHandler, ok } from './registry';

export interface SystemApiOptions {
  device: DeviceProfile;
  baseLibVersion: string;
  /** 当前页面可用高度（扣除导航栏、tabBar） */
  windowHeight: () => number;
}

export const NAVIGATION_BAR_HEIGHT = 44;
export const TAB_BAR_HEIGHT = 50;

export function createSystemApis(options: SystemApiOptions): Record<string, ApiHandler> {
  const { device } = options;

  const windowInfo = () => ({
    pixelRatio: device.pixelRatio,
    screenWidth: device.screenWidth,
    screenHeight: device.screenHeight,
    windowWidth: device.screenWidth,
    windowHeight: options.windowHeight(),
    statusBarHeight: device.statusBarHeight,
    safeArea: {
      left: 0,
      right: device.screenWidth,
      top: device.statusBarHeight,
      bottom: device.screenHeight,
      width: device.screenWidth,
      height: device.screenHeight - device.statusBarHeight
    },
    screenTop: device.statusBarHeight + NAVIGATION_BAR_HEIGHT
  });

  const deviceInfo = () => ({
    brand: 'devtools',
    model: device.model,
    system: device.system,
    platform: device.platform,
    benchmarkLevel: 1,
    abi: 'arm64',
    deviceAbi: 'arm64',
    cpuType: 'unknown',
    memorySize: 4096
  });

  const appBaseInfo = () => ({
    SDKVersion: options.baseLibVersion,
    enableDebug: false,
    host: { env: 'WeChat', appId: '' },
    language: 'zh_CN',
    version: '8.0.50',
    theme: 'light',
    fontSizeSetting: 16
  });

  const authorizeSetting = () => ({
    albumAuthorized: 'authorized',
    bluetoothAuthorized: 'authorized',
    cameraAuthorized: 'authorized',
    locationAuthorized: 'authorized',
    locationReducedAccuracy: false,
    microphoneAuthorized: 'authorized',
    notificationAuthorized: 'authorized',
    phoneCalendarAuthorized: 'authorized'
  });

  const systemSetting = () => ({
    bluetoothEnabled: true,
    locationEnabled: true,
    wifiEnabled: true,
    deviceOrientation: 'portrait'
  });

  const systemInfo: ApiHandler = (args, { api }) => {
    switch (args.type) {
      case 'windowInfo': return ok(api, windowInfo());
      case 'deviceInfo': return ok(api, deviceInfo());
      case 'appBaseInfo': return ok(api, appBaseInfo());
      case 'appAuthorizeSetting': return ok(api, authorizeSetting());
      case 'systemSetting': return ok(api, systemSetting());
    }
    return ok(api, {
      ...deviceInfo(),
      ...windowInfo(),
      ...appBaseInfo(),
      ...systemSetting(),
      albumAuthorized: true,
      cameraAuthorized: true,
      locationAuthorized: true,
      microphoneAuthorized: true,
      notificationAuthorized: true
    });
  };

  return {
    getSystemInfo: systemInfo,
    getSystemInfoSync: systemInfo,
    getSystemInfoAsync: systemInfo,
    getWindowInfo: (_args, { api }) => ok(api, windowInfo()),
    getDeviceInfo: (_args, { api }) => ok(api, deviceInfo()),
    getAppBaseInfo: (_args, { api }) => ok(api, appBaseInfo()),
    getAppAuthorizeSetting: (_args, { api }) => ok(api, authorizeSetting()),
    getSystemSetting: (_args, { api }) => ok(api, systemSetting()),
    getNetworkType: (_args, { api }) => ok(api, { networkType: 'wifi', signalStrength: 100, hasSystemProxy: false }),
    getBatteryInfo: (_args, { api }) => ok(api, { level: 100, isCharging: true }),
    getBatteryInfoSync: (_args, { api }) => ok(api, { level: 100, isCharging: true }),
    getMenuButtonBoundingClientRect: (_args, { api }) => {
      const top = device.statusBarHeight + 6;
      const right = device.screenWidth - 7;
      return ok(api, { width: 87, height: 32, top, right, bottom: top + 32, left: right - 87 });
    },
    getScreenBrightness: (_args, { api }) => ok(api, { value: 0.8 }),
    setScreenBrightness: () => undefined,
    setKeepScreenOn: () => undefined,
    vibrateShort: () => undefined,
    vibrateLong: () => undefined
  };
}
