Page({
  data: { price: '' },
  loadPrice() {
    require.async('../../packageB/utils/price.js')
      .then(price => this.setData({ price: price.format(1999) }))
      .catch(({ errMsg }) => this.setData({ price: `加载失败：${errMsg}` }));
  },
  toList() {
    wx.navigateTo({ url: '/packageA/pages/list/list' });
  }
});
