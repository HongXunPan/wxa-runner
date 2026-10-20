# 自定义 tabBar 示例

照[官方文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/custom-tabbar.html)的示例代码写的自定义 tabBar：
`app.json` 的 `tabBar.custom` 设为 `true`，根目录的 `custom-tab-bar` 组件渲染 tabBar，tab 页在 `onShow` 里用
`getTabBar()` 更新选中态。另外加了一个非 tab 页面（详情页），那里不显示 tabBar。

在仓库根目录运行：

```bash
pnpm build
node packages/cli/bin/wxa-runner.js dev examples/custom-tabbar --open
```
