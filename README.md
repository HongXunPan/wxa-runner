# wxa-runner

> 在普通浏览器里，用**微信官方基础库**运行小程序。为本地调试和 E2E 自动化测试而生。

**[文档](https://open-wxa.github.io/wxa-runner/)** · [English](./README.en.md) · 中文

```bash
npx wxa-runner dev ./dist/dev/mp-weixin   # 原生小程序目录，或 uni-app / Taro 编译产物
# → http://localhost:3000
```

- **和真机一致**：直接运行小程序的编译产物，渲染、组件、`setData`、生命周期都是微信官方基础库的代码，不是 H5 那样由框架重新实现
- **无头 E2E**：用 Playwright 直接在浏览器里测试，不用远程控制开发者工具；CI 里无头运行，Linux 上不需要开发者工具
- **用熟悉的工具调试**：Chrome DevTools 打断点、看网络请求、看 DOM，保存后热更新
- **跳过走不通的环节**：在 setup 里预置登录态、mock 原生 API、拦截请求，不用改业务代码

它不替代开发者工具：预览、上传、真机调试仍然要用开发者工具。

## 个人 fork 维护说明

本 fork 的维护目标是：`main` 保存“上游代码 + 自有修复 + 维护配置”，作为可直接使用的主线，
不再将 `main` 作为上游的纯镜像。迁移 PR 合并并将默认分支切回 `main` 后，此维护方式生效。

当前纳入的自有修复：
- 自定义 tabBar：补齐隐式组件入口及其依赖，见上游 [PR #47](https://github.com/open-wxa/wxa-runner/pull/47)。
- 普通分包：补齐本地就绪和预加载任务协议，见上游 [PR #48](https://github.com/open-wxa/wxa-runner/pull/48)。
  不代表支持真实分包下载、独立分包隔离或全部分包异步化能力。

维护约定：
- 无论上游是否接受上述 PR，fork 都可保留自有修复；独立 PR 分支不混入维护配置。
- 每天北京时间 08:17 检查上游，也可手动运行“创建上游同步 PR”；调度可能延迟。
  已包含上游时不建 PR，有更新时只创建 fork 内的普通合并 PR，不直接更新 `main`。
- 同时最多保留一个待处理的同步 PR；已有候选或历史 PR 时不覆盖、不重复创建。
  合并冲突、推送或权限失败时任务停止，由维护者检查日志并处理，不自动重试。
- Actions 需开启“Allow GitHub Actions to create and approve pull requests”，工作流仅创建 PR，
  不批准、不自动合并。CI 若等待批准，需维护者审阅后批准运行，再检查结果并手动合并。
- 合并前检查补丁与发布保护；有问题可关闭 PR，`main` 不变；已合并后通过回退 PR 撤销，不强推重置主线。
- fork 不自动发布 npm、tag 或 GitHub Release；文档工作流只构建，不部署 GitHub Pages。
  旧 `ci/upstream-sync` 调度分支留存，旧镜像同步任务保持停用。

上面的 `npx wxa-runner` 使用上游 npm 发行版，不包含本 fork 尚未被上游收录的修复。
使用自有修复需按 [源码构建说明](./CONTRIBUTING.md#构建与测试)构建本 fork，再通过源码 CLI 入口运行。

## 文档

- [快速开始](https://open-wxa.github.io/wxa-runner/getting-started)：安装、基础库和编译器
- [启动前准备（setup）](https://open-wxa.github.io/wxa-runner/setup)：跳过登录、mock 原生 API、拦截 `wx.request`
- [真实登录](https://open-wxa.github.io/wxa-runner/real-login)：借开发者工具的登录态拿真实的 code 和手机号
- [热更新](https://open-wxa.github.io/wxa-runner/hot-reload)
- [在 Playwright 中测试](https://open-wxa.github.io/wxa-runner/testing)
- [命令与环境变量](https://open-wxa.github.io/wxa-runner/cli)
- [功能与限制](https://open-wxa.github.io/wxa-runner/features)

## 参与开发

从源码构建、运行示例和测试见 [CONTRIBUTING.md](./CONTRIBUTING.md)。欢迎提交 Issue 和 PR。

## 致谢

- 微信团队：官方基础库与编译器
- [WEPT](https://github.com/chemzqm/wept)：最早验证了在浏览器中运行小程序的可行性

## 许可证

[MIT](./LICENSE)。内置基础库 [wxa-baselib](https://github.com/open-wxa/wxa-baselib) 是微信官方代码，版权归腾讯所有，不适用本项目的 MIT 协议。
