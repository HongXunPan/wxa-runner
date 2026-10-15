/**
 * 热更新分流：文件改动能否在不刷新整页的情况下应用（浏览器端应用见 runtime/host/hmr.ts）
 */

export interface HotUpdatePlan {
  /** 模板要更新的页面和组件（不带扩展名） */
  templates: string[];
  /** 逻辑要更新的页面和组件（不带扩展名） */
  scripts: string[];
  /** 改动的样式文件（不带扩展名），包括 app.wxss 和被 @import 的文件 */
  styles: string[];
}

/**
 * @param files 相对小程序根目录的改动文件
 * @returns null 表示需要整页刷新：只要有一个文件既不是样式，也不是页面或组件自己的 WXML / JS
 */
export function planHotUpdate(files: string[], units: { pages: string[]; components: string[] }): HotUpdatePlan | null {
  const owners = new Set([...units.pages, ...units.components]);
  const plan: HotUpdatePlan = { templates: [], scripts: [], styles: [] };

  for (const file of files) {
    const id = file.replace(/\.(wxml|js|wxss)$/, '');
    const target = file.endsWith('.wxss')
      ? plan.styles
      : !owners.has(id) ? null : file.endsWith('.wxml') ? plan.templates : file.endsWith('.js') ? plan.scripts : null;
    if (!target) return null;
    if (!target.includes(id)) target.push(id);
  }
  return plan;
}
