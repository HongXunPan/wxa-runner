/**
 * 页面栈：只管顺序和上限，页面的创建与销毁由调用方处理
 */

export const MAX_PAGE_STACK = 10;

export class PageStack<T> {
  private items: T[] = [];

  constructor(private readonly max = MAX_PAGE_STACK) {}

  get size(): number {
    return this.items.length;
  }

  current(): T | undefined {
    return this.items[this.items.length - 1];
  }

  entries(): T[] {
    return [...this.items];
  }

  canPush(): boolean {
    return this.items.length < this.max;
  }

  push(item: T) {
    if (!this.canPush()) throw new Error('webview count limit exceed');
    this.items.push(item);
  }

  /** 至少保留栈底页面；返回被弹出的页面（栈顶在前） */
  pop(delta = 1): T[] {
    const count = Math.max(0, Math.min(Math.floor(delta) || 1, this.items.length - 1));
    return this.items.splice(this.items.length - count, count).reverse();
  }

  /** 替换栈顶，返回原栈顶 */
  replaceTop(item: T): T | undefined {
    const previous = this.items.pop();
    this.items.push(item);
    return previous;
  }

  /** 清空并放入新页面，返回原有页面 */
  reset(item: T): T[] {
    const previous = this.items;
    this.items = [item];
    return previous.filter(existing => existing !== item);
  }
}
