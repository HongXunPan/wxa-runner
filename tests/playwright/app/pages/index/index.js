Page({
  data: { count: 0, code: '', visits: 0, location: '', order: '' },

  onLoad() {
    getApp().login.then(code => this.setData({ code }));
    const visits = (wx.getStorageSync('visits') || 0) + 1;
    wx.setStorageSync('visits', visits);
    this.setData({ visits });
  },

  add(step) {
    this.setData({ count: this.data.count + step });
    return this.data.count;
  },

  onAdd() {
    this.add(1);
  },

  onDetail() {
    wx.navigateTo({ url: '/pages/detail/detail?id=42' });
  },

  onLocate() {
    wx.getLocation({
      type: 'gcj02',
      success: res => this.setData({ location: `${res.latitude},${res.longitude}` }),
      fail: err => this.setData({ location: err.errMsg })
    });
  },

  onOrder() {
    wx.request({
      url: 'https://api.example.com/api/orders',
      method: 'POST',
      data: { sku: 'A1', count: this.data.count },
      success: res => this.setData({ order: res.statusCode === 201 ? `下单成功：${res.data.id}` : '下单失败' }),
      fail: () => this.setData({ order: '网络错误' })
    });
  },

  send(url, data) {
    return new Promise(resolve => wx.request({
      url,
      method: 'POST',
      data,
      success: res => resolve(res.data),
      fail: err => resolve(err.errMsg)
    }));
  },

  uploadBytes(url) {
    return new Promise(resolve => wx.request({
      url,
      method: 'POST',
      header: { 'content-type': 'application/octet-stream' },
      data: new Uint8Array([0x89, 0x50, 0xff]).buffer,
      success: res => resolve(res.data),
      fail: err => resolve(err.errMsg)
    }));
  },

  /** 按 arraybuffer 请求，返回「是不是 ArrayBuffer 字节列表」 */
  download(url) {
    return new Promise(resolve => wx.request({
      url,
      responseType: 'arraybuffer',
      success: res => resolve(`${res.data instanceof ArrayBuffer} ${Array.from(new Uint8Array(res.data))}`),
      fail: err => resolve(err.errMsg)
    }));
  },

  crashLater() {
    Promise.reject(new Error('页面里没有处理的错误'));
  }
});
