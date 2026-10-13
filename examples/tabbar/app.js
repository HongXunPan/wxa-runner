// app.js
App({
  globalData: {
    userInfo: null,
    version: '1.0.0'
  },

  onLaunch: function(options) {
    console.log('App Launch', options)
    console.log('wxa-runner uni-app 测试项目启动')

    // 测试 Storage
    wx.setStorageSync('app_launch_time', Date.now())
  },

  onShow: function(options) {
    console.log('App Show', options)
  },

  onHide: function() {
    console.log('App Hide')
  }
})
