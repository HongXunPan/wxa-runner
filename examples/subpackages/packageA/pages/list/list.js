Page({
  data: { price: '' },
  onLoad() {
    require('../../../packageB/utils/price.js', price => {
      this.setData({ price: `到手价 ${price.format(5900)}` });
    }, ({ errMsg }) => {
      this.setData({ price: `加载失败：${errMsg}` });
    });
  }
});
