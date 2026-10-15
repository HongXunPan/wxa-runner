# 启动前准备（setup）

浏览器里拿不到真实的 `wx.login` code、用户信息、定位等。在项目目录（`project.config.json` 所在目录）放一个 `wxa.setup.ts`，
它在 `App.onLaunch` 之前执行，让小程序直接进入「已登录」之类的状态。

```ts
// wxa.setup.ts
import { defineSetup } from '@open-wxa/wxa-runner-core/setup';

export default defineSetup(({ env }) => ({
  // 预置存储：值保持原类型，wx.getStorageSync 读到的就是这些值
  storage: {
    token: env.WXA_TOKEN,
    userInfo: { id: 1, nickName: '测试用户' }
  },
  // 覆盖原生 API：对象作为返回结果；函数按调用参数返回，抛错即调用失败
  mock: {
    login: { code: 'dev_code' },
    getLocation: { latitude: 31.23, longitude: 121.47 }
  },
  // 拦截 wx.request：'[请求方法 ]地址'，* 匹配一段路径，** 匹配任意内容（可以不写域名）
  // 值是响应（body 为对象时按 JSON 返回），也可以是按请求返回响应的函数
  network: {
    routes: {
      'POST **/api/auth/login': { body: { code: 200, data: { token: env.WXA_TOKEN } } },
      'GET **/api/user/*': req => ({ status: 404, body: { msg: `没有 ${req.url}` } })
    }
  },
  // 在上面的配置之后执行，适合异步、动态的逻辑
  async run(wxa) {
    const res = await wxa.fetch('https://test-api.example.com/dev/token');  // 经代理，无跨域限制
    wxa.storage.set('token', (await res.json()).token);
  }
}));
```

## 怎么选

- 启动时只检查本地 token：用 `storage` 预置 token
- 每次启动都调 `wx.login`，再请求后端换 token：用 `network.routes` 拦截登录接口，直接返回 token；
  或者用 `mock.login` 返回测试后端认可的 code
- 需要真实的 code 或手机号：用 [真实登录](#真实登录)

## 规则

- **执行时机**：每次打开、刷新页面都会重新执行，顺序固定为 storage → mock → network → run。修改 setup 文件后页面自动刷新
- **环境变量**：只有 `WXA_` 开头的变量会传给 setup，如 `WXA_TOKEN=xxx wxa-runner dev .`。setup 在浏览器里执行，密钥不要直接写在文件里
- **反馈**：执行结果打印在浏览器控制台（`[wxa-runner] setup 已应用`）。配置写错或执行出错时，模拟器显示错误，小程序不会启动
- **类型提示**：不装任何依赖也能运行。把 `@open-wxa/wxa-runner-core` 加为开发依赖后有完整的类型提示
- **存储要在启动前写入**：基础库会把读过的存储缓存在内存里，启动后再从外部改 localStorage，小程序读不到

## 拦截请求

- `wx.request` 不能用 `mock` 覆盖，要用 `network.routes`。命中的请求会在控制台打印 `[wxa-runner] 拦截请求`
- 拦截的响应默认立即返回，比真机早到。业务代码在回调里假设「首页已经创建」之类时会出错，可以加 `delay`（毫秒）模拟网络耗时
- `downloadFile`、`uploadFile`、`connectSocket` 暂不拦截

## 真实登录

后端要用真实的 code 换取 session，或者要拿到真实手机号时，启动时加上 `--real-login`：

```bash
wxa-runner dev ./dist/dev/mp-weixin --real-login
```

- 用本机微信开发者工具的登录态（开发者 ticket）向微信换取 `wx.login` 的 code 和手机号。
  当前登录的微信账号必须是 `project.config.json` 里这个 appid 的开发者
- 登录态过期时，在开发者工具里重新登录即可，不用重启。也可以用环境变量 `WECHAT_DEV_TICKET` 直接指定 ticket
- 请求失败时调用返回失败并说明原因，不会退回模拟数据
- 开发者 ticket 很快过期，不适合 CI。CI 里请用 `mock` 和 `network.routes`
