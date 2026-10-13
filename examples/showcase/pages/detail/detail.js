Page({
  data: { id: '' },
  onLoad(query) {
    this.setData({ id: query.id })
  },
  back() {
    wx.navigateBack()
  }
})
