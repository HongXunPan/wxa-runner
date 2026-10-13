/**
 * 界面 API：toast / loading / modal / actionSheet / 导航栏
 */

import type { NavigationState, PhoneShell } from '../ui/PhoneShell';
import { ApiHandler, fail, ok } from './registry';

export interface UiApiOptions {
  shell: PhoneShell;
  /** 修改当前页面的导航栏状态（随页面保存，返回时恢复） */
  updateNavigation: (state: Partial<NavigationState>) => void;
}

export function createUiApis({ shell, updateNavigation }: UiApiOptions): Record<string, ApiHandler> {
  return {
    showToast: args => shell.showToast(args),
    hideToast: () => shell.hideToast(),
    showLoading: args => shell.showToast({ ...args, icon: 'loading', duration: 0 }),
    hideLoading: () => shell.hideToast(),
    showModal: async (args, { api }) => ok(api, await shell.showModal(args)),
    showActionSheet: async (args, { api }) => {
      const tapIndex = await shell.showActionSheet(args);
      return tapIndex === null ? fail(api, 'cancel') : ok(api, { tapIndex });
    },

    setNavigationBarTitle: args => updateNavigation({ title: String(args.title ?? '') }),
    setNavigationBarColor: args => updateNavigation({
      backgroundColor: args.backgroundColor,
      textStyle: String(args.frontColor).toLowerCase() === '#000000' ? 'black' : 'white'
    }),
    showNavigationBarLoading: () => shell.setNavigationLoading(true),
    hideNavigationBarLoading: () => shell.setNavigationLoading(false),
    hideHomeButton: () => undefined,
    setBackgroundColor: () => undefined,
    setBackgroundTextStyle: () => undefined,
    startPullDownRefresh: () => undefined,
    stopPullDownRefresh: () => undefined
  };
}
