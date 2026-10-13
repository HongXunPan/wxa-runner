App({
  globalData: { launchedAt: 0 },
  onLaunch() {
    this.globalData.launchedAt = Date.now()
    console.log('[showcase] App onLaunch')
  },
  onShow() {
    console.log('[showcase] App onShow')
  }
})
