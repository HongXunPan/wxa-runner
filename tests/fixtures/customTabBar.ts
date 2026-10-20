/** 自定义 tabBar 的最小原生小程序，供构建与浏览器回归复用。 */
export const customTabBarFiles = {
  'app.json': {
    pages: ['pages/home/index', 'pages/mine/index', 'pages/detail/index'],
    tabBar: {
      custom: true,
      list: [
        { pagePath: 'pages/home/index', text: '首页' },
        { pagePath: 'pages/mine/index', text: '我的' }
      ]
    }
  },
  'app.js': 'App({});',
  'pages/home/index.json': {},
  'pages/home/index.wxml': '<view id="count" bindtap="increment">计数：{{count}}</view><view id="detail" bindtap="detail">打开详情</view>',
  'pages/home/index.js': `Page({
    data: { count: 0 },
    onShow() { this.getTabBar(tab => tab.setData({ selected: 0 })); },
    increment() { this.setData({ count: this.data.count + 1 }); },
    detail() { wx.navigateTo({ url: '/pages/detail/index' }); }
  });`,
  'pages/mine/index.json': {},
  'pages/mine/index.wxml': '<view>我的页面</view>',
  'pages/mine/index.js': `Page({
    onShow() { this.getTabBar(tab => tab.setData({ selected: 1 })); }
  });`,
  'pages/detail/index.json': {},
  'pages/detail/index.wxml': '<view id="back" bindtap="back">返回</view>',
  'pages/detail/index.js': 'Page({ back() { wx.navigateBack(); } });',
  'custom-tab-bar/index.json': {
    component: true,
    usingComponents: { 'tab-label': '/components/tab-label/index' }
  },
  'custom-tab-bar/index.js': `Component({
    data: { selected: 0, taps: 0 },
    methods: {
      switch(e) {
        this.setData({ taps: this.data.taps + 1 });
        wx.switchTab({ url: e.currentTarget.dataset.path });
      }
    }
  });`,
  'custom-tab-bar/index.wxml': `<view class="custom-tabs">
    <view id="tab-selected" data-testid="tab-selected">选中：{{selected}}</view>
    <view id="tab-taps" data-testid="tab-taps">点击：{{taps}}</view>
    <view id="tab-home" data-testid="tab-home" data-path="/pages/home/index" bindtap="switch"><tab-label label="首页" /></view>
    <view id="tab-mine" data-testid="tab-mine" data-path="/pages/mine/index" bindtap="switch"><tab-label label="我的" /></view>
  </view>`,
  'custom-tab-bar/index.wxss': '.custom-tabs { position: fixed; bottom: 0; left: 0; right: 0; padding: 20rpx; background: #eeeeee; }',
  'components/tab-label/index.json': { component: true },
  'components/tab-label/index.js': 'Component({ properties: { label: String } });',
  'components/tab-label/index.wxml': '<text>{{label}}</text>'
};
