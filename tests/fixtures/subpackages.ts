/** 覆盖预加载、原生任务协议、模块异步引用与静态资源，不向 wx 补造主动加载接口。 */
export const subpackageFiles = {
  'app.json': {
    pages: ['pages/index/index'],
    subPackages: [{ root: 'pkg', name: 'named', pages: ['detail/index'] }],
    preloadRule: { 'pages/index/index': { network: 'all', packages: ['named'] } }
  },
  'app.js': 'App({});',
  'pages/index/index.json': {},
  'pages/index/index.wxml': `
    <view id="load-result">协议加载：{{result}}</view>
    <view id="progress">进度：{{progress}}</view>
    <view id="success-count">成功次数：{{successes}}</view>
    <view id="complete-count">完成次数：{{completes}}</view>
    <view id="resource-result">资源：{{resource}}</view>
    <image wx:if="{{imageSrc}}" src="{{imageSrc}}" bindload="imageLoaded" binderror="imageFailed" />
    <view id="again" bindtap="load">再次加载</view>
    <view id="unknown" bindtap="unknown">加载未知包</view>
    <view id="unknown-result">未知包：{{unknownResult}}</view>
    <view id="async" bindtap="asyncModule">异步引用模块</view>
    <view id="async-result">模块：{{asyncResult}}</view>
    <view id="detail" bindtap="detail">打开分包页面</view>`,
  'pages/index/index.js': `
  // 3.7.0 的小程序 wx 未暴露主动加载方法；这里只测试原生桥协议，预加载仍由真实基础库驱动。
  const tasks = new Map();
  WeixinJSBridge.on('onLoadSubPackageTaskStateChange', event => {
    const callback = tasks.get(event.taskId);
    if (callback) callback(event);
    if (event.state === 'success' || event.state === 'fail') tasks.delete(event.taskId);
  });
  function loadNative(moduleName, progress, complete) {
    WeixinJSBridge.invoke('createLoadSubPackageTask', { moduleName }, result => {
      if (!result.loadTaskId) return complete(false);
      tasks.set(result.loadTaskId, event => {
        if (event.state === 'progressUpdate') progress(event.progress);
        else if (event.state === 'success' || event.state === 'fail') complete(event.state === 'success');
      });
      WeixinJSBridge.invoke('listenLoadSubPackageTaskStateChange', {
        taskId: result.loadTaskId, states: ['progressUpdate']
      }, () => {});
    });
  }
  Page({
    data: {
      result: '等待', progress: -1, successes: 0, completes: 0,
      resource: '等待', imageSrc: '', unknownResult: '未触发', asyncResult: '未触发'
    },
    onLoad() { this.load(); },
    load() {
      loadNative('/pkg/', progress => this.setData({ progress }), success => this.setData({
        result: success ? '成功' : '失败',
        successes: this.data.successes + Number(success), completes: this.data.completes + 1,
        imageSrc: success ? '/pkg/assets/pixel.png' : ''
      }));
    },
    imageLoaded() { this.setData({ resource: '成功' }); },
    imageFailed() { this.setData({ resource: '失败' }); },
    unknown() {
      loadNative('/missing/', () => {}, success => this.setData({
        unknownResult: success ? '错误成功' : '明确失败且已完成'
      }));
    },
    asyncModule() {
      require.async('../../pkg/ready.js').then(
        module => this.setData({ asyncResult: module.value }),
        () => this.setData({ asyncResult: '失败' })
      );
    },
    detail() { wx.navigateTo({ url: '/pkg/detail/index' }); }
  });`,
  'pkg/detail/index.json': {},
  'pkg/detail/index.wxml': '<view>分包页面已渲染</view><view id="back" bindtap="back">返回主包</view>',
  'pkg/detail/index.js': 'Page({ back() { wx.navigateBack(); } });',
  'pkg/ready.js': "exports.value = '异步模块已就绪';",
  'pkg/assets/pixel.png': Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzuYAAAAASUVORK5CYII=',
    'base64'
  )
};
