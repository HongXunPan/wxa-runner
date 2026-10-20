Page({
  data: { count: 0 },
  onShow() {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
  },
  increment() {
    this.setData({ count: this.data.count + 1 });
  },
  detail() {
    wx.navigateTo({ url: '/pages/detail/index' });
  }
});
