Page({
  onShow() {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
  }
});
