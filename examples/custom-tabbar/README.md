# 自定义 tabBar 示例

完成仓库的源码构建后，在仓库根目录运行：

```bash
node packages/cli/bin/wxa-runner.js dev examples/custom-tabbar --open
```

- 不在页面中显式引用 tabBar，验证固定入口及递归子组件的收集。
- 首页点击计数后切换到“我的”再返回，页面计数保持，tabBar 点击记录不会因切换被重建清零。
- 每次点击先修改离开页面的选中态，返回时由页面 `onShow` 通过 `getTabBar().setData()` 恢复。
- 打开详情页时隐藏 tabBar，返回首页后恢复。
- `data-testid` 是浏览器测试的稳定定位标记，不依赖基础库生成的组件 ID 前缀。

自动化用例使用 1280×1000 视口，保证 1:1 显示时底部按钮位于可点击区域；不改变运行时缩放策略。
