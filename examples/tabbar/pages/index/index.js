// pages/index/index.js
Page({
  data: {
    version: '1.0.0',
    count: 0,
    message: 'Hello wxa-runner!',
    inputValue: '',
    showMessage: false,
    items: [
      { id: 1, name: '测试项目 1' },
      { id: 2, name: '测试项目 2' },
      { id: 3, name: '测试项目 3' }
    ]
  },

  onLoad: function(options) {
    console.log('[Index] onLoad', options)
  },

  onShow: function() {
    console.log('[Index] onShow')
  },

  onReady: function() {
    console.log('[Index] onReady')
  },

  // 路由测试
  navigateToTest: function() {
    console.log('navigateTo /pages/test/test')
    wx.navigateTo({
      url: '/pages/test/test?from=index'
    })
  },

  switchToTest: function() {
    console.log('switchTab /pages/test/test')
    wx.switchTab({
      url: '/pages/test/test'
    })
  },

  // Storage 测试
  testStorage: function() {
    const key = 'test_key'
    const value = { data: 'test_value', timestamp: Date.now() }

    wx.setStorageSync(key, value)
    const result = wx.getStorageSync(key)

    console.log('Storage 测试:', result)

    wx.showToast({
      title: 'Storage 测试成功',
      icon: 'success'
    })
  },

  // 网络请求测试
  testRequest: function() {
    wx.showLoading({ title: '请求中...' })

    wx.request({
      url: 'https://api.github.com/repos/open-wxa/wxa-runner',
      success: (res) => {
        console.log('请求成功:', res)
        wx.hideLoading()
        wx.showToast({
          title: '请求成功',
          icon: 'success'
        })
      },
      fail: (err) => {
        console.error('请求失败:', err)
        wx.hideLoading()
        wx.showToast({
          title: '请求失败',
          icon: 'none'
        })
      }
    })
  },

  // 系统信息测试
  testSystemInfo: function() {
    const info = wx.getSystemInfoSync()
    console.log('系统信息:', info)

    wx.showModal({
      title: '系统信息',
      content: `设备: ${info.model}\n系统: ${info.system}\n屏幕: ${info.screenWidth}x${info.screenHeight}`,
      showCancel: false
    })
  },

  // Toast 测试
  showToast: function() {
    wx.showToast({
      title: '这是一个 Toast',
      icon: 'success',
      duration: 2000
    })
  },

  // Modal 测试
  showModal: function() {
    wx.showModal({
      title: '提示',
      content: '这是一个模态对话框',
      success: (res) => {
        if (res.confirm) {
          console.log('用户点击确定')
        } else if (res.cancel) {
          console.log('用户点击取消')
        }
      }
    })
  },

  // Loading 测试
  showLoading: function() {
    wx.showLoading({
      title: '加载中...'
    })

    setTimeout(() => {
      wx.hideLoading()
    }, 2000)
  },

  // 数据绑定测试
  increment: function() {
    this.setData({
      count: this.data.count + 1
    })
  },

  onInput: function(e) {
    this.setData({
      inputValue: e.detail.value,
      message: e.detail.value || 'Hello wxa-runner!'
    })
  },

  // 条件渲染测试
  toggleShow: function() {
    this.setData({
      showMessage: !this.data.showMessage
    })
  }
})
