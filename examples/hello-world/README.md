# wxa-runner Hello World 示例

这是 wxa-runner 的最简示例项目，展示了基础功能。

## 功能展示

- ✅ 页面渲染
- ✅ 数据绑定 (`setData`)
- ✅ 事件处理 (`bindtap`)
- ✅ UI 组件 (`wx.showToast`, `wx.showModal`)
- ✅ Storage API (`wx.setStorageSync`, `wx.getStorageSync`)
- ✅ 系统信息 (`wx.getSystemInfoSync`)

## 运行方式

```bash
# 在项目根目录
pnpm install
pnpm build

# 启动示例
cd examples/hello-world
wxa-runner dev .

# 或者直接指定路径
wxa-runner dev examples/hello-world
```

然后在浏览器打开 http://localhost:3000

## 项目结构

```
hello-world/
├── app.js              # 小程序入口
├── app.json            # 全局配置
├── app.wxss            # 全局样式
├── sitemap.json        # 站点地图
└── pages/
    └── index/
        ├── index.js    # 页面逻辑
        ├── index.json  # 页面配置
        ├── index.wxml  # 页面结构
        └── index.wxss  # 页面样式
```

## 注意事项

**Phase 1 限制**:
- ⚠️  需要手动提供编译后的 WXML/WXSS（或者提取官方基础库）
- ⚠️  部分 API 尚未实现

**Phase 2 将支持**:
- ✅ 自动编译 WXML/WXSS
- ✅ 热更新 (HMR)
- ✅ 更多 wx.* API
