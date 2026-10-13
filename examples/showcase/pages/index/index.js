const { recordVisit } = require('../../utils/store.js')

Page({
  data: {
    greeting: 'Hello from the official base library',
    cents: 12345,
    visits: 0,
    count: 1,
    items: [{ id: 1, name: 'WXML' }, { id: 2, name: 'WXSS' }, { id: 3, name: 'WXS' }],
    requestResult: '',
    modalResult: ''
  },
  onLoad(query) {
    console.log('[showcase] index onLoad', JSON.stringify(query))
    this.setData({ visits: recordVisit() })
  },
  onReady() {
    console.log('[showcase] index onReady')
  },
  onCounterChange(e) {
    this.setData({ count: e.detail.value })
  },
  doRequest() {
    wx.request({
      url: 'https://httpbin.org/get?from=wxa-runner',
      success: (res) => this.setData({ requestResult: 'status ' + res.statusCode }),
      fail: (err) => this.setData({ requestResult: 'fail ' + err.errMsg })
    })
  },
  toast() {
    wx.showToast({ title: '你好', icon: 'success' })
  },
  modal() {
    wx.showModal({
      title: '确认',
      content: '继续吗？',
      success: (res) => this.setData({ modalResult: res.confirm ? 'confirm' : 'cancel' })
    })
  },
  goDetail() {
    wx.navigateTo({ url: '/pages/detail/detail?id=42' })
  }
})
