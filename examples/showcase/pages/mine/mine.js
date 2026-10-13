Page({
  data: { visits: 0 },
  onShow() {
    this.setData({ visits: wx.getStorageSync('showcase:visits') || 0 })
  }
})
