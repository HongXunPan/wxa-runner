Page({
  onShow() {
    if (typeof this.getTabBar === 'function' &&
      this.getTabBar()) {
      this.getTabBar().setData({
        selected: 0
      })
    }
  },
  toDetail() {
    wx.navigateTo({ url: '/detail/detail' })
  }
})
