App({
  onLaunch() {
    // 跨分包的组件或 JS 加载失败时触发
    wx.onLazyLoadError(res => console.error('分包异步化加载失败', res));
  }
});
