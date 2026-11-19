# Hachimi Daily Check-in for Surge iOS

一个小型、无依赖的 Surge iOS 模块：每天 09:05 检查并尝试签到 `mambo-hachimi.biliblili.uk`。这是独立第三方站点，**不是** `bilibili.com` 官方服务；使用前请自行评估是否信任该站点及其登录接口。

> **重要限制**：脚本及模拟测试均未使用真实账户登录，也没有对站点执行过任何认证请求。API 契约部分来自公开前端资源、部分为推断；请先审阅源代码并自行判断。测试通过只说明模拟行为符合预期，不代表线上站点已验证。

## 文件

- `HachimiCheckin.sgmodule` — Surge iOS 模块：每日 cron、手动运行入口、一次性 Setup 入口。
- `scripts/setup.js` — 从 Shortcuts 接收账号和密码，写入本机 Surge 持久化存储；`DELETE` 可清除本项目的凭据和令牌。
- `scripts/checkin.js` — 登录（首次/过期时）、读取签到状态，并至多提交一次签到。
- `test/checkin.test.js` — 使用 Node.js `vm` 和模拟 Surge 全局对象的离线测试，无第三方依赖。
- `LICENSE` — MIT。

## 安装模块

在 Surge iOS 中导入：

```text
https://raw.githubusercontent.com/yeah1z1/mambo-hachimi-checkin-surge/main/HachimiCheckin.sgmodule
```

1. 安装并启用模块后，进入 **模块 → 本模块 →「编辑参数」**。
2. 填写 `username`（账号）和 `password`（密码），保存。
3. 启用 cron 后，脚本按设备本地日程每天 09:05 运行；`wake-system=true` 请求 Surge 在设备空闲时唤醒执行。

不用 MITM，不需要安装证书，也不需要 Shortcuts。

## 填写账号密码（模块参数）

模块用 Surge 的 Parameter Tables（`#!arguments`）声明了两个参数，启用模块或点「编辑参数」时，Surge 会显示可填写、可回显的界面：

| 参数 | 含义 |
|---|---|
| `username` | 站点账号（用户名或邮箱） |
| `password` | 站点密码 |

参数值由 Surge 保存在**本机模块配置**中，不会写入本仓库。每日签到与手动签到优先使用这两个值；填好后不需要额外操作。

**例外**：模块行是逗号分隔的，若密码含英文逗号 `,` 或双引号 `"`，参数替换可能破坏该行解析。这类密码请改用下面的备用方式。

### 备用：用 Hachimi Setup 保存到本机存储

1. 同样先在「编辑参数」填好账号密码。
2. 在 Surge 脚本列表中手动运行一次 `Hachimi Setup`。它会读取模块参数并写入 `$persistentStore`，同时清除旧会话令牌。
3. 之后即使清空模块参数，签到脚本仍会从本机存储读取（参数为空的场景才回退）。

也可以用快捷指令调用 `Hachimi Setup` 并传入「账号换行密码」，效果相同。

### 删除本机保存的凭据

在快捷指令中调用 `Hachimi Setup`，参数传 `DELETE`；或把模块参数清空后运行一次。脚本会用 `$persistentStore.write(null, ...)` 删除本项目保存的账号、密码和会话令牌，不影响 Surge 其他数据。

## 手动运行与验证处理

- 在 Surge 脚本列表运行 `Hachimi Manual Check-in`，或点模块里的手动签到脚本；它会复用「编辑参数」里的账号密码。
- `scripts/checkin.js` 先 GET `/api/checkin/status`；若显示今天已签到则结束，否则 POST `/api/checkin` 一次。
- 已保存会话的状态 GET 收到 401 时，最多重新登录一次并重读状态。签到 POST **从不自动重试**；若提交网络中断或结果不确定，通知用户手动打开网页核对。
- 遇到验证码、Turnstile、验证挑战、已知 HTML WAF 页面、重定向、403 或 429 时停止并通知用户手动处理。脚本不会获取/伪造验证令牌，不会尝试绕过 CAPTCHA 或挑战。
- 登录请求按已知前端形状发送 `verificationToken: null`；如果服务端要求实际验证令牌，脚本应停止，不会绕过。

## 凭据与请求安全

- 账号密码优先来自模块参数（Surge 保存在本机模块配置中）；若运行过 `Hachimi Setup`，也会以 JSON 形式存于 `$persistentStore`。两者都是**本机存储，不是 Keychain**；不要将本项目用于共享/不受信任设备，也不要截图分享「编辑参数」页面。Surge/iOS 的备份、设备访问和应用安全策略由用户自行评估。
- 登录只向固定 HTTPS 地址 `https://mambo-hachimi.biliblili.uk/api/auth/login` 发送 JSON 请求；状态/签到只访问同一固定 origin 的对应 API 路径。请求不跟随重定向，自动 Cookie 关闭，不输出请求/响应、账户、密码或令牌到日志/通知。脚本没有代理其他账户或站点的通用接口。
- 项目源代码及测试中没有真实用户凭据；测试只在进程内动态构造虚构数据。不要把自己的凭据提交到公开仓库。
- 根据目前提供的公开前端契约：登录 POST `{userName,password,rememberMe:false,verificationToken:null}`，响应含 `{token,user}`；会话使用 `Authorization: Bearer <token>`；状态 GET 返回 `success,hasCheckedInToday,amount,currencyUnit`；签到 POST `{}`，响应成功包含 `success,amount,currencyUnit`，重复签到可能以 HTTP 400 `{hasCheckedIn:true}` 表示。**这些认证 API 的实际线上行为尚未实测，字段若不符脚本会安全停止而非猜测提交。**

## 离线模拟测试

要求 Node.js 18+（内置 `node:test`）：

```sh
node --check scripts/setup.js
node --check scripts/checkin.js
node --test
```

测试覆盖成功签到、今日已签到、过期令牌的单次重登录、登录被拒、挑战拦截、签到 POST 网络错误不重试、模块参数解析（含密码内的 `&`/`=`）、参数为空时回退本机存储、`Hachimi Setup` 保存/清除，以及成功响应里 `verificationRequired:false` / `verificationToken:null` 不被误判为挑战。测试不会访问网络。

## 参考

- [Surge cron scripts](https://manual.nssurge.com/scripting/cron.md)
- [Surge JavaScript API（HTTP Client、Persistent Store、Notifications）](https://manual.nssurge.com/scripting/api.md)
- [Surge generic scripts / Shortcuts 参数](https://manual.nssurge.com/scripting/generic.md)
- [Surge scripting overview](https://manual.nssurge.com/scripting/overview.md)
- [Surge module format](https://manual.nssurge.com/profile/module.md)
