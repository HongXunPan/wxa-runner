/**
 * 一个页面对应一个渲染层 iframe
 */

import type { FrameBridge } from '../types';
import type { NavigationState } from './ui/PhoneShell';

type PendingDispatch = (bridge: FrameBridge, win: Window) => void;

export class PageView {
  readonly frame: HTMLIFrameElement;
  readonly ready: Promise<void>;
  win: Window | null = null;
  bridge: FrameBridge | null = null;
  navigation: NavigationState;
  private markReady!: () => void;
  private pending: PendingDispatch[] = [];

  constructor(
    readonly id: number,
    readonly path: string,
    readonly query: Record<string, string>,
    container: HTMLElement,
    version: number,
    navigation: NavigationState
  ) {
    this.navigation = navigation;
    this.ready = new Promise(resolve => {
      this.markReady = resolve;
    });

    this.frame = document.createElement('iframe');
    this.frame.name = `wxa-webview-${id}`;
    this.frame.dataset.webviewId = String(id);
    this.frame.dataset.path = path;
    this.frame.style.visibility = 'hidden';
    this.frame.src = `/__wxa__/webview/${path}.html?id=${id}&v=${version}`;
    container.appendChild(this.frame);
  }

  get url(): string {
    const query = new URLSearchParams(this.query).toString();
    return query ? `${this.path}?${query}` : this.path;
  }

  attach(win: Window, bridge: FrameBridge) {
    this.win = win;
    this.bridge = bridge;
    const pending = this.pending;
    this.pending = [];
    pending.forEach(dispatch => dispatch(bridge, win));
  }

  /** 渲染层脚本全部执行完（含 generateFuncReady）后调用 */
  loaded() {
    this.markReady();
  }

  /** 渲染层还没注册桥时先缓存，注册后按顺序补发 */
  dispatch(fn: PendingDispatch) {
    if (this.bridge && this.win) fn(this.bridge, this.win);
    else this.pending.push(fn);
  }

  /** data-current 是给测试用的公开契约：iframe[data-current] 始终指向当前页 */
  show() {
    this.frame.style.visibility = 'visible';
    this.frame.style.zIndex = '1';
    this.frame.dataset.current = '';
  }

  hide() {
    this.frame.style.visibility = 'hidden';
    this.frame.style.zIndex = '0';
    delete this.frame.dataset.current;
  }

  destroy() {
    this.frame.remove();
    this.win = null;
    this.bridge = null;
  }
}
