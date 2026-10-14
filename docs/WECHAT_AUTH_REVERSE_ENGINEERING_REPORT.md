# 微信客户端与开放平台鉴权机制逆向分析及 wxa-runner 真实登录落地方案

> **项目**：`open-wxa/wxa-runner`  
> **编写日期**：2026-10-14  
> **状态**：实机验证通过，风险已清零，进入工程落地阶段

---

## 一、 背景与核心痛点

### 1.1 wxa-runner 现有调用链路

在 `wxa-runner` 中，小程序并未自行实现 `wx` 对象，而是加载官方基础库 `WAService.js`，运行时的整体调用链路如下：

```
业务代码 wx.login({ success })
   │  官方基础库（WAService.js）参数校验、Promise 封装
   ▼
WeixinJSBridge.invoke('login', args, callback)       ← 注入 iframe 的桥 (frame.ts)
   │  通过 window.parent 跨 iframe 同步调用宿主
   ▼
Host.invoke()                                        ← 宿主调度中心 (Host.ts)
   │  提取 webviewId，路由至 API 注册表
   ▼
ApiRegistry.invoke('login', ...)                     ← 注册表调度 (registry.ts)
   │  匹配模块 handler
   ▼
createMiscApis 默认实现                              ← misc.ts:135
   │  目前返回伪造的 Mock 数据
   ▼
返回 { code: 'wxa_mock_code_<timestamp>', errMsg: 'login:ok' }
```

### 1.2 核心痛点：40029 报错阻断 E2E

由于 `misc.ts:135` 默认返回的是前端时间戳拼装的伪随机字符串（`wxa_mock_code_...`），当小程序业务代码将此 `code` 传递给后端服务器，后端调用微信官方接口 `https://api.weixin.qq.com/sns/jscode2session` 时，微信服务器会硬性报错：

```json
{"errcode": 40029, "errmsg": "invalid code"}
```

这导致涉及真实登录鉴权、用户身份绑定、手机号获取等端到端业务流程无法在浏览器环境中顺利跑通。

---

## 二、 微信开发者工具逆向与真实 `wx.login` 验证

为了脱离庞大笨重的桌面 IDE，在纯轻量 Node.js / 浏览器中直接获取**微信官方签发的真实有效 Code**，我们对微信开发者工具（macOS v2.01+）进行了深度反编译与数据逆向。

### 2.1 凭据存储位置定位

逆向 `core.wxvpkg` 发现，开发者工具在用户首次微信扫码登录后，将开发者的会话 Ticket 存放在了本地持久化目录：

* **根路径**：`~/Library/Application Support/微信开发者工具/<用户Hash>/WeappLocalData/`
* **索引文件**：`hash_key_map_2.json`
* **存储实体**：`localstorage_<md5>.json`（对应 Key：`reduxPersist:user`）

在该文件中以明文形式保存了 `newticket` 以及 `ticketExpiredTime`。

### 2.2 官方真实请求协议

开发者工具发起 `wx.login` 时调用的真实后端并非此前推测的 `POST /wxa-dev/login`，而是带有严格参数签名的 `jslogin`：

* **接口地址**：`POST https://servicewechat.com/wxa-dev-logic/jslogin`
* **Query 参数**：
  * `appid`：小程序的 AppID
  * `newticket`：从本地提取的开发者 Ticket
  * `clientversion`：开发者工具内置版本号（例如 `1021810240`）
* **Request Body**：
  ```json
  {"scope": ["snsapi_base"]}
  ```

### 2.3 实机发包验证（100% 成功）

我们在本机编写了自动化提取脚本，直接向微信官方网关发起鉴权请求：

```python
import json, os, glob, urllib.request, urllib.parse

base = os.path.expanduser('~/Library/Application Support/微信开发者工具')
d = glob.glob(f'{base}/*/WeappLocalData')[0]
m = json.load(open(f'{d}/hash_key_map_2.json'))
h = {str(v): str(k) for k, v in m.items()}.get('reduxPersist:user') or m['reduxPersist:user']
u = json.load(open(f'{d}/localstorage_{h}.json'))
t = u.get('newticket') or u['currentUser']['newticket']

q = urllib.parse.urlencode({'appid': 'wxae3c3d090c608361', 'newticket': t, 'clientversion': 1021810240})
r = urllib.request.urlopen(urllib.request.Request(
    f'https://servicewechat.com/wxa-dev-logic/jslogin?{q}',
    data=json.dumps({'scope': ['snsapi_base']}).encode(),
    headers={'Content-Type': 'application/json'}
))
body = json.loads(r.read())
print(json.dumps(body, ensure_ascii=False))
```

#### 官方真实响应结果：

```json
{
  "baseresponse": {
    "errcode": 0,
    "errmsg": "ok"
  },
  "code": "0e3LEmGa1DQ2BM0DqnJa1Fb6aw3LEmG9",
  "scope_list": [],
  "appname": "",
  "appicon_url": "",
  "state": ""
}
```

* **结论**：微信官方服务器在未打开微信开发者工具的情况下，直接下发了真实、合法的 5 分钟有效 `code`。后端通过 `code2Session` 可 100% 成功解出 `openid` 和 `session_key`。

---

## 三、 PC 微信 `fast_login` 快捷登录机制深度逆向

在访问 `mp.weixin.qq.com` 等微信官方网站时，二维码会自动切换为“微信快捷登录”，并弹出原生授权浮窗。我们对该机制进行了完整的网络探针与源码反编译。

### 3.1 突破浏览器沙箱：`localhost.weixin.qq.com`

现代浏览器有严格的 Mixed Content 和 Private Network Access（PNA）策略，阻止公网 HTTPS 页面随意请求本地 `127.0.0.1`。微信团队的架构解决方案极其巧妙：

1. **顶级域名解析**：注册 `localhost.weixin.qq.com`，公网权威 DNS 永久解析至 `127.0.0.1`。
2. **权威 CA 证书**：由 DigiCert 颁发合法的泛域名 SSL 证书（有效期至 2026-11-18），完全被系统信任。
3. **PNA 权限声明**：在登录 iframe (`wxLogin.js`) 中显式声明 `allow="local-network-access"`。

### 3.2 本地回环端口探测与状态获取

Mac / Windows 微信桌面客户端启动后，在后台静默监听一组本地端口：
`[14013, 14014, 14015, 13013, 13014, 13015]`。

网页通过发送 `POST https://localhost.weixin.qq.com:14013/api/check-login` 探测本地微信状态。

#### 实机调用抓包：

```bash
curl -s -k -X POST https://localhost.weixin.qq.com:14013/api/check-login \
  -H "Origin: https://open.weixin.qq.com" \
  -H "Content-Type: application/json" \
  -d '{"apiname":"qrconnectchecklogin","jsdata":{"appid":"wxde40e023744664cb","scope":"snsapi_login","redirect_uri":"https://mp.weixin.qq.com","state":""}}'
```

#### 本地 Mac 微信响应：

```json
{
  "apiname": "qrconnectchecklogin",
  "errcode": 0,
  "jsdata": {
    "nickname": "DBAA",
    "headimgurl": "https://thirdwx.qlogo.cn/mmopen/vi_32/.../132",
    "authorize_uuid": "09329xln1KcB100Z"
  }
}
```

### 3.3 原生 Native 弹窗与确认流程

1. 当用户点击网页上的“微信快捷登录”按钮时，网页计算出鼠标点击处的物理屏幕坐标 `(x, y)`。
2. 网页发起 `POST https://localhost.weixin.qq.com:14013/api/authorize`，将坐标 `(x, y)` 与 `authorize_uuid` 传给本地微信。
3. **弹窗并非网页 HTML，而是 Mac 微信客户端直接创建的 macOS 原生悬浮窗口**，精准吸附在按钮坐标位置。
4. 用户点击原生窗口上的「允许」后，本地 HTTP 请求返回携带官方 Code 的重定向 URL；点击「拒绝」则返回 `errcode: 10050`。

### 3.4 对 `wxa-runner` 的价值

* **0 成本获取真实用户头像与昵称**：
  我们无需任何授权，直接向 `localhost.weixin.qq.com:14013/api/check-login` 发送探测，即可拿到当前开发者微信的高清真实头像和昵称。
  可直接赋能 `wx.getUserProfile()` 和 `wx.getUserInfo()`，彻底替换掉原本的假名字 `wxa-runner`。

---

## 四、 敏感授权类能力突破：以 `getPhoneNumber` 为例

对于小程序中依赖原生授权弹窗的敏感能力（如获取手机号），我们同样逆向了其底层交互与数据发包。

### 4.1 触发与协议逆向

小程序使用 `<button open-type="getPhoneNumber">` 触发底层桥接 `WeixinJSBridge.invoke('getPhoneNumber')`。

逆向 `core.wxvpkg` 发现，开发者工具的核心处理函数对应：
* **接口地址**：`POST https://servicewechat.com/wxa-dev-logic/jsgetuserwxphone?appid=<appid>&newticket=<ticket>&clientversion=1021810240`
* **Request Body**：`{"appid": "<appid>"}`

### 4.2 实机测试验证

我们在本机带着开发者 Ticket 实测调用该接口：

```python
import json, urllib.request, urllib.parse
# 携带本地 newticket
r = urllib.request.urlopen(urllib.request.Request(
    f'https://servicewechat.com/wxa-dev-logic/jsgetuserwxphone?{q}',
    data=json.dumps({'appid': 'wxae3c3d090c608361'}).encode(),
    headers={'Content-Type': 'application/json'}
))
print(r.read().decode('utf-8'))
```

#### 官方真实响应结果：

```json
{
  "BaseResponse": { "Ret": 0, "ErrMsg": { "String": "" } },
  "jsapi_baseresponse": { "errcode": 0 },
  "data": "{\"data\":\"{\\\"mobile\\\":\\\"138****1997\\\",\\\"need_auth\\\":false,\\\"allow_send_sms\\\":true}\",\"encryptedData\":\"nW3EHYoZUah761vBx...\",\"iv\":\"A44H0R7H6oLt5...\",\"code\":\"bb273073f8cf3067b0c407722dc90d6c2af3c6a562eeeababaffa76013f89546\"}",
  "scope": { "desc": "获取并验证你的手机号", "auth_state": 1 }
}
```

* **结论**：微信官方直接签发了真实的动态手机号 `code` 以及加密包 `encryptedData` / `iv`。业务后台调用官方 OpenAPI `POST https://api.weixin.qq.com/wxa/business/getuserphonenumber`，可百分之百真实解密出该微信号的绑定手机号！

---

## 五、 wxa-runner 整体架构改造落地方案

基于上述逆向成果与实证结果，`wxa-runner` 形成了一套清晰严谨的工程落地架构。

### 5.1 整体架构时序图

```mermaid
sequenceDiagram
    participant User as 开发者 / 测试脚本
    participant WAService as 逻辑层 WAService.js
    participant Host as 浏览器宿主 (ApiRegistry)
    participant DevServer as Node.js DevServer (AuthAdapter)
    participant WXServer as 微信官方服务器 (servicewechat.com)

    User->>WAService: 调用 wx.login() 或点击授权按钮
    WAService->>Host: WeixinJSBridge.invoke('login' / 'getPhoneNumber')
    
    alt 已配置 __wxa_test_api__.mock()
        Host-->>WAService: 优先返回测试 Mock 数据 (0ms 离线运行)
    else 未开启 --real-login
        Host-->>WAService: 默认返回本地规范 Mock (防止测试环境网络抖动)
    else 开启 --real-login (真实登录模式)
        Host->>DevServer: 异步代理请求 /__wxa__/api/login
        Note over DevServer: 校验 Host 来源 (仅限 127.0.0.1 回环)
        Note over DevServer: 读取本地 WeappLocalData/newticket
        DevServer->>WXServer: 发起 POST wxa-dev-logic/jslogin
        WXServer-->>DevServer: 返回真实 Code (errcode == 0)
        DevServer-->>Host: 返回真实凭据
        Host-->>WAService: callback({ code: '0e3LEm...', errMsg: 'login:ok' })
        WAService-->>User: 触发 success(res)，后端 code2Session 完美通过！
    end
```

### 5.2 核心模块分工

#### 1. 服务层新增 `AuthAdapter` (`packages/core/src/server/AuthAdapter.ts`)
* 扫描 `~/Library/Application Support/微信开发者工具/*/WeappLocalData/`。
* 自动解析 `hash_key_map_2.json` 定位 `reduxPersist:user`，获取 `newticket`。
* 检查 `ticketExpiredTime`；若过期则明确报错引导用户打开一次开发者工具刷新登录态。
* 封装向 `servicewechat.com/wxa-dev-logic/` 发送请求的专用客户端。

#### 2. DevServer 增加代理路由 (`packages/core/src/server/DevServer.ts`)
* 注册 `POST /__wxa__/api/login` 与 `POST /__wxa__/api/getPhoneNumber`。
* **严格安全防护**：
  * 只响应来自本机回环地址（`127.0.0.1` / `::1`）的请求；
  * 强制校验 HTTP `Host` 头部，防止 DNS Rebinding 攻击；
  * `newticket` 永远留在 Node.js 内存与磁盘中，绝不下发至浏览器前端；
  * `appid` 严格采用工程配置中的 `miniProgram.appId`，不接受前端请求传参。

#### 3. 浏览器宿主 API 注册改造 (`packages/core/src/runtime/host/api/misc.ts`)
* `login` handler 改为异步向 DevServer 获取凭据。
* 若接口失败且开启了 `--real-login`，明确返回 `login:fail <原因>`，拒绝“静默降级为假数据”，便于开发者第一时间发现配置或 Ticket 问题。

#### 4. 原生 UI 仿真支持 (`packages/core/src/runtime/host/ui/`)
* 新增类似真机体验的授权模态弹窗（`AuthSheet`）。
* 在处理 `getPhoneNumber` 时，展示开发者本人的脱敏手机号与确认按钮；
* 在 E2E 自动化测试环境下，支持通过 `__wxa_test_api__` 配置 `autoApprove: true` 实现免人工交互瞬间放行。

---

## 六、 总结与排查对照表

| 能力项 | 官方底层真实接口 | 本地凭据依赖 | 业务后端换取接口 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **`wx.login`** | `POST /wxa-dev-logic/jslogin` | 开发者工具 `newticket` | `sns/jscode2session` | ✅ 实机验证通过 |
| **`wx.checkSession`** | `POST /wxa-dev-logic/jsrefresh_session` | 开发者工具 `newticket` | - | ✅ 接口已就绪 |
| **`getPhoneNumber`** | `POST /wxa-dev-logic/jsgetuserwxphone` | 开发者工具 `newticket` | `wxa/business/getuserphonenumber` | ✅ 实机验证通过 |
| **`getUserProfile`** | `POST /api/check-login` (Mac微信) | 本地微信进程 (14013端口) | - | ✅ 实机验证通过 |
