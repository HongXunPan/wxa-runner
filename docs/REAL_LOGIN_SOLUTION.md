# wxa-runner 获取真实 wx.login code 方案设计

## 1. 背景与痛点

当前 `wxa-runner` 宿主在 `packages/core/src/runtime/host/api/misc.ts:135` 对 `wx.login` 的实现为：

```typescript
login: (_args, { api }) => ok(api, { code: `wxa_mock_code_${Date.now().toString(36)}` }),
```

这仅能保证小程序前端 `success` 回调正常执行。但当小程序业务代码将此 `code` 发送给业务后端，后端调用微信官方 `auth.code2Session`（`https://api.weixin.qq.com/sns/jscode2session`）时，微信服务器会报错 `40029 (invalid code)`，导致无法完成完整的端到端登录流程。

---

## 2. 微信开发者工具底层逆向原理

微信开发者工具本质也是一个基于 NW.js / Chromium 的环境，它能获取真实 `code` 的核心机制如下：

1. **凭据持久化（Ticket）**：
   - 开发者在使用开发者工具前必须用手机微信扫码登录。
   - 登录成功后，工具将该开发者的会话凭据（Ticket / Session Cookie）持久化在本地磁盘：
     - macOS 路径：`~/Library/Application Support/微信开发者工具/...`
2. **官方网关代理调用**：
   - 当小程序的 `WAService.js` 发起 `invoke('login')` 时，开发者工具并未在前端 mock，而是由桌面端 Node.js/C++ 后台携带本地存储的 `Ticket` 向微信开发服务网关发起请求：
     ```http
     POST https://servicewechat.com/wxa-dev/login
     Headers:
       X-WX-Ticket: <本地持久化的 Ticket>
       Content-Type: application/json
     Body:
       { "appid": "<当前小程序 appId>" }
     ```
3. **下发真实有效 code**：
   - 微信服务器校验该 Ticket 对应的开发者具有该 `appid` 的开发权限后，签发一个真实、有效（有效期 5 分钟）的 `code`。
   - 业务后端拿这个 `code` 调 `code2Session`，能正常解出真实的 `openid` 和 `session_key`。

---

## 3. wxa-runner 真实登录落地方案（AuthAdapter）

在纯浏览器中，我们无法直接访问本地文件系统或发起受限请求，但 `wxa-runner` 拥有本地的 **Node.js DevServer**。可以通过将登录请求向上代理给 DevServer 来完成真实凭据透传：

### 架构调用链路

```
业务代码 wx.login({ success })
   │
   ▼
WAService.js ➔ WeixinJSBridge.invoke('login')
   │
   ▼
宿主 Host.invoke('login') ➔ ApiRegistry
   │
   ├─► [Mock 检查] 若 window.__wxa_test_api__ 注册了 mock('login')，优先走 Mock
   │
   ▼
fetch('/__wxa__/api/login') ➔ 异步请求本地 Node.js DevServer
                                  │
                                  ▼
                            AuthAdapter (Node.js 端)
                                  │
                                  ├─ 策略 1（优先）：读取本地微信开发者工具持久化 Ticket
                                  │   代发 POST https://servicewechat.com/wxa-dev/login
                                  │
                                  ├─ 策略 2（备选）：若无本地工具，支持 CLI 扫码独立获取 Ticket
                                  │   缓存于 ~/.wxa-runner/auth.json
                                  │
                                  └─ 策略 3（兜底）：网络异常或未登录时，降级返回 mock_code
                                  │
   ▲ 微信官方返回真实 code ◄────────┘
   │
Host 接收真实 code ➔ callback({ code, errMsg: 'login:ok' })
   │
   ▼
WAService.js 触发 success 回调
```

---

## 4. 关键改造点与实现指南

### 4.1 Node.js 端：DevServer 增加登录路由与 AuthAdapter

在 `packages/core/src/server/DevServer.ts` 中增加接口：

```typescript
// 伪代码示例
app.get('/__wxa__/api/login', async (req, res) => {
  try {
    const authAdapter = new AuthAdapter(miniProgram.appId);
    const result = await authAdapter.getRealLoginCode();
    res.json(result); // { code: '081xxxx...', errMsg: 'login:ok' }
  } catch (err) {
    // 降级为 mock
    res.json({
      code: `wxa_mock_code_${Date.now().toString(36)}`,
      errMsg: 'login:ok',
      isMock: true
    });
  }
});
```

### 4.2 浏览器端：修改 misc.ts 的 login handler

在 `packages/core/src/runtime/host/api/misc.ts` 中：

```typescript
login: async (_args, { api }) => {
  try {
    const res = await fetch('/__wxa__/api/login').then(r => r.json());
    return ok(api, { code: res.code });
  } catch {
    return ok(api, { code: `wxa_mock_code_${Date.now().toString(36)}` });
  }
}
```

### 4.3 兼容性保证

1. **测试优先**：`window.__wxa_test_api__.mock('login', ...)` 机制保持不变，单元测试和 E2E 依然可以秒级无网络运行。
2. **无感降级**：当本地未安装开发者工具或 Ticket 过期时，静默降级为原有 Mock 模式，不阻塞前端界面流程，并在终端打印提示信息。
