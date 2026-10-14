/**
 * 热更新分流：文件改动能否在不刷新整页的情况下应用（浏览器端应用见 runtime/host/hmr.ts）
 */

export interface HotUpdatePlan {
  /** 模板要更新的页面和组件（不带扩展名） */
  templates: string[];
  /** 逻辑要更新的页面（不带扩展名） */
  pages: string[];
}

/**
 * @param files 相对小程序根目录的改动文件
 * @returns null 表示需要整页刷新：只要有一个文件不属于「页面/组件自己的 WXML」或「页面 JS」
 */
export function planHotUpdate(files: string[], units: { pages: string[]; components: string[] }): HotUpdatePlan | null {
  const pages = new Set(units.pages);
  const templateOwners = new Set([...units.pages, ...units.components]);
  const plan: HotUpdatePlan = { templates: [], pages: [] };

  for (const file of files) {
    const id = file.replace(/\.(wxml|js)$/, '');
    if (file.endsWith('.wxml') && templateOwners.has(id)) {
      if (!plan.templates.includes(id)) plan.templates.push(id);
    } else if (file.endsWith('.js') && pages.has(id)) {
      if (!plan.pages.includes(id)) plan.pages.push(id);
    } else {
      return null;
    }
  }
  return plan;
}
