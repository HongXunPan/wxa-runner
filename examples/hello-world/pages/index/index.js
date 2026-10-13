// pages/index/index.js
Page({
  data: {
    message: 'Hello wxa-runner!',
    count: 0
  },

  onLoad: function (options) {
    console.log('Page onLoad', options)
  },

  onShow: function () {
    console.log('Page onShow')
  },

  onReady: function () {
    console.log('Page onReady')
  },

  // 点击按钮
  handleTap: function () {
    console.log('Button tapped!')
    this.setData({
      count: this.data.count + 1
    })
  },

  // 显示 Toast
  showToast: function () {
    wx.showToast({
      title: '成功',
      icon: 'success',
      duration: 2000
    })
  },

  // 显示 Modal
  showModal: function () {
    wx.showModal({
      title: '提示',
      content: '这是一个模态弹窗',
      success: function (res) {
        if (res.confirm) {
          console.log('用户点击确定')
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  },

  // 测试 Storage
  testStorage: function () {
    wx.setStorageSync('test_key', 'test_value')
    const value = wx.getStorageSync('test_key')
    console.log('Storage value:', value)

    wx.showToast({
      title: 'Storage: ' + value,
      icon: 'none'
    })
  },

  // 测试系统信息
  testSystemInfo: function () {
    const systemInfo = wx.getSystemInfoSync()
    console.log('System Info:', systemInfo)

    wx.showModal({
      title: '系统信息',
      content: `设备: ${systemInfo.model}\n系统: ${systemInfo.system}\n屏幕: ${systemInfo.screenWidth}x${systemInfo.screenHeight}`,
      showCancel: false
    })
  }
})
