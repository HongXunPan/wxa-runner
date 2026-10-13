/**
 * 模拟手机外壳：状态栏、导航栏、页面容器、tabBar 和系统弹层
 */

import type { DeviceProfile } from '../../types';
import { NAVIGATION_BAR_HEIGHT, TAB_BAR_HEIGHT } from '../api/system';
import { SHELL_CSS } from './styles';

export interface NavigationState {
  title: string;
  backgroundColor: string;
  textStyle: string;
  showBack: boolean;
  custom: boolean;
}

export interface TabBarConfig {
  color?: string;
  selectedColor?: string;
  backgroundColor?: string;
  borderStyle?: string;
  custom?: boolean;
  list: Array<{ pagePath: string; text?: string; iconPath?: string; selectedIconPath?: string }>;
}

export interface ToastOptions {
  title?: string;
  icon?: 'success' | 'error' | 'loading' | 'none';
  image?: string;
  duration?: number;
  mask?: boolean;
}

export interface ModalOptions {
  title?: string;
  content?: string;
  showCancel?: boolean;
  cancelText?: string;
  cancelColor?: string;
  confirmText?: string;
  confirmColor?: string;
  editable?: boolean;
  placeholderText?: string;
}

export interface ActionSheetOptions {
  alertText?: string;
  itemList: string[];
  itemColor?: string;
}

export class PhoneShell {
  readonly pages: HTMLElement;
  private readonly device: HTMLElement;
  private readonly statusBar: HTMLElement;
  private readonly navBar: HTMLElement;
  private readonly navTitle: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly tabBar: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly routeLabel: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private tabBarConfig: TabBarConfig | null = null;
  private onTabTap: (pagePath: string, index: number) => void = () => undefined;
  private navigation: NavigationState = { title: '', backgroundColor: '#000', textStyle: 'white', showBack: false, custom: false };
  private tabBarVisible = false;

  constructor(root: HTMLElement, private readonly profile: DeviceProfile) {
    const style = document.createElement('style');
    style.textContent = SHELL_CSS;
    document.head.appendChild(style);

    root.innerHTML = `
      <div class="wxa-stage">
        <div class="wxa-device" style="width:${profile.screenWidth}px;height:${profile.screenHeight}px">
          <div class="wxa-statusbar" style="height:${profile.statusBarHeight}px"><span>9:41</span><span>100%</span></div>
          <div class="wxa-navbar">
            <button class="wxa-navbar-back" title="返回" aria-label="返回">‹</button>
            <span class="wxa-navbar-loading"></span><span class="wxa-navbar-title"></span>
            <div class="wxa-capsule"></div>
          </div>
          <div class="wxa-pages"></div>
          <div class="wxa-tabbar is-hidden"></div>
          <div class="wxa-overlay"></div>
        </div>
        <div class="wxa-toolbar"><span class="wxa-route"></span><button class="wxa-reload">刷新</button></div>
      </div>`;

    this.device = root.querySelector('.wxa-device')!;
    this.statusBar = root.querySelector('.wxa-statusbar')!;
    this.navBar = root.querySelector('.wxa-navbar')!;
    this.navTitle = root.querySelector('.wxa-navbar-title')!;
    this.backButton = root.querySelector('.wxa-navbar-back')!;
    this.pages = root.querySelector('.wxa-pages')!;
    this.tabBar = root.querySelector('.wxa-tabbar')!;
    this.overlay = root.querySelector('.wxa-overlay')!;
    this.routeLabel = root.querySelector('.wxa-route')!;
    root.querySelector('.wxa-reload')!.addEventListener('click', () => location.reload());
  }

  onBack(handler: () => void) {
    this.backButton.addEventListener('click', handler);
  }

  setTabBar(config: TabBarConfig | undefined, onTap: (pagePath: string, index: number) => void) {
    this.tabBarConfig = config && config.list?.length && !config.custom ? config : null;
    this.onTabTap = onTap;
  }

  setRoute(route: string) {
    this.routeLabel.textContent = route;
  }

  setNavigation(state: Partial<NavigationState>) {
    this.navigation = { ...this.navigation, ...state };
    const { title, backgroundColor, textStyle, showBack, custom } = this.navigation;
    const color = textStyle === 'black' ? '#000' : '#fff';

    this.navTitle.textContent = title;
    this.backButton.style.visibility = showBack ? 'visible' : 'hidden';
    this.navBar.classList.toggle('is-hidden', custom);
    this.navBar.style.background = backgroundColor;
    this.navBar.style.color = color;
    // 自定义导航栏时页面从屏幕顶部开始绘制，状态栏浮在页面上
    this.statusBar.style.background = custom ? 'transparent' : backgroundColor;
    this.statusBar.style.color = custom ? '#000' : color;
    this.statusBar.style.position = custom ? 'absolute' : '';
    this.statusBar.style.left = this.statusBar.style.right = custom ? '0' : '';
    this.statusBar.style.zIndex = custom ? '5' : '';
  }

  getNavigation(): NavigationState {
    return { ...this.navigation };
  }

  setNavigationLoading(loading: boolean) {
    this.navBar.classList.toggle('is-loading', loading);
  }

  /** 当前页面是 tabBar 页面时传入它的路径，否则传 null */
  renderTabBar(selectedPath: string | null) {
    const config = this.tabBarConfig;
    this.tabBarVisible = !!config && selectedPath !== null && config.list.some(item => item.pagePath === selectedPath);
    this.tabBar.classList.toggle('is-hidden', !this.tabBarVisible);
    if (!config || !this.tabBarVisible) return;

    this.tabBar.style.background = config.backgroundColor || '#f7f7f7';
    this.tabBar.style.borderTopColor = config.borderStyle === 'white' ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.1)';
    this.tabBar.innerHTML = '';
    config.list.forEach((item, index) => {
      const selected = item.pagePath === selectedPath;
      const el = document.createElement('div');
      el.className = 'wxa-tabbar-item' + (selected ? ' is-selected' : '');
      el.dataset.pagePath = item.pagePath;
      el.style.color = selected ? (config.selectedColor || '#07c160') : (config.color || '#7a7e83');
      const icon = selected ? item.selectedIconPath || item.iconPath : item.iconPath;
      if (icon) {
        const img = document.createElement('img');
        img.src = '/' + icon.replace(/^\//, '');
        el.appendChild(img);
      }
      const text = document.createElement('span');
      text.textContent = item.text || '';
      el.appendChild(text);
      el.addEventListener('click', () => this.onTabTap(item.pagePath, index));
      this.tabBar.appendChild(el);
    });
  }

  /** 页面可用高度，与 getSystemInfo().windowHeight 对应 */
  windowHeight(): number {
    const { custom } = this.navigation;
    return this.profile.screenHeight
      - (custom ? 0 : this.profile.statusBarHeight + NAVIGATION_BAR_HEIGHT)
      - (this.tabBarVisible ? TAB_BAR_HEIGHT : 0);
  }

  showToast(options: ToastOptions) {
    this.hideToast();
    const icon = options.image ? 'image' : options.icon || 'success';
    const wrapper = document.createElement('div');
    if (options.mask) wrapper.appendChild(maskElement(false));

    const toast = document.createElement('div');
    toast.className = 'wxa-toast' + (icon === 'none' ? '' : ' has-icon');
    toast.setAttribute('role', 'alert');
    if (icon === 'loading') {
      toast.appendChild(element('div', 'wxa-toast-spinner'));
    } else if (icon === 'image') {
      const img = document.createElement('img');
      img.src = options.image!;
      img.width = img.height = 40;
      toast.appendChild(img);
    } else if (icon !== 'none') {
      toast.appendChild(element('div', 'wxa-toast-icon', icon === 'error' ? '✕' : '✓'));
    }
    toast.appendChild(element('div', 'wxa-toast-title', options.title || ''));
    wrapper.appendChild(toast);

    this.overlay.appendChild(wrapper);
    this.toastEl = wrapper;
    if (icon !== 'loading' || options.duration) {
      this.toastTimer = setTimeout(() => this.hideToast(), options.duration ?? 1500);
    }
  }

  hideToast() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toastEl?.remove();
    this.toastEl = null;
  }

  showModal(options: ModalOptions): Promise<{ confirm: boolean; cancel: boolean; content?: string }> {
    return new Promise(resolve => {
      const wrapper = document.createElement('div');
      wrapper.appendChild(maskElement(true));
      const modal = element('div', 'wxa-modal');
      modal.setAttribute('role', 'dialog');
      if (options.title) modal.appendChild(element('div', 'wxa-modal-title', options.title));
      if (options.content && !options.editable) modal.appendChild(element('div', 'wxa-modal-content', options.content));

      let input: HTMLInputElement | null = null;
      if (options.editable) {
        input = document.createElement('input');
        input.className = 'wxa-modal-input';
        input.value = options.content || '';
        input.placeholder = options.placeholderText || '';
        modal.appendChild(input);
      }

      const actions = element('div', 'wxa-modal-actions');
      const close = (confirm: boolean) => {
        wrapper.remove();
        resolve({ confirm, cancel: !confirm, ...(options.editable ? { content: input!.value } : {}) });
      };
      if (options.showCancel !== false) {
        const cancel = element('button', 'wxa-modal-cancel', options.cancelText || '取消');
        cancel.style.color = options.cancelColor || '#000';
        cancel.addEventListener('click', () => close(false));
        actions.appendChild(cancel);
      }
      const confirm = element('button', 'wxa-modal-confirm', options.confirmText || '确定');
      confirm.style.color = options.confirmColor || '#576b95';
      confirm.addEventListener('click', () => close(true));
      actions.appendChild(confirm);
      modal.appendChild(actions);

      wrapper.appendChild(modal);
      this.overlay.appendChild(wrapper);
    });
  }

  showActionSheet(options: ActionSheetOptions): Promise<number | null> {
    return new Promise(resolve => {
      const wrapper = document.createElement('div');
      const mask = maskElement(true);
      const sheet = element('div', 'wxa-actionsheet');
      const close = (index: number | null) => {
        wrapper.remove();
        resolve(index);
      };

      if (options.alertText) sheet.appendChild(element('div', 'wxa-actionsheet-alert', options.alertText));
      options.itemList.forEach((text, index) => {
        const button = element('button', 'wxa-actionsheet-item', text);
        button.style.color = options.itemColor || '#000';
        button.addEventListener('click', () => close(index));
        sheet.appendChild(button);
      });
      const cancel = element('button', 'wxa-actionsheet-cancel', '取消');
      cancel.addEventListener('click', () => close(null));
      sheet.appendChild(cancel);
      mask.addEventListener('click', () => close(null));

      wrapper.append(mask, sheet);
      this.overlay.appendChild(wrapper);
    });
  }

  showError(message: string) {
    this.clearError();
    const el = element('div', 'wxa-error', message);
    this.device.appendChild(el);
  }

  clearError() {
    this.device.querySelector('.wxa-error')?.remove();
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function maskElement(dim: boolean): HTMLElement {
  return element('div', 'wxa-mask' + (dim ? ' is-dim' : ''));
}
