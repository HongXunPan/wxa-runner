// pages/test/test.js
Page({
  data: {
    logs: [],
    from: ''
  },

  onLoad: function(options) {
    console.log('[Test] onLoad', options)
    this.addLog('onLoad: ' + JSON.stringify(options))
    this.setData({
      from: options.from || '未知'
    })
  },

  onShow: function() {
    console.log('[Test] onShow')
    this.addLog('onShow')
  },

  onReady: function() {
    console.log('[Test] onReady')
    this.addLog('onReady')
  },

  onHide: function() {
    console.log('[Test] onHide')
    this.addLog('onHide')
  },

  onUnload: function() {
    console.log('[Test] onUnload')
  },

  addLog: function(message) {
    const logs = this.data.logs
    logs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`)
    this.setData({
      logs: logs.slice(0, 10) // 只保留最近 10 条
    })
  },

  navigateBack: function() {
    wx.navigateBack({
      delta: 1
    })
  },

  reLaunch: function() {
    wx.reLaunch({
      url: '/pages/index/index'
    })
  }
})
