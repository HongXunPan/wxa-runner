App({
  onLaunch() {
    // 启动时就登录：测试要在小程序启动前 mock 才来得及
    this.login = new Promise(resolve => wx.login({
      success: res => resolve(res.code),
      fail: err => resolve(err.errMsg)
    }));
  }
});
