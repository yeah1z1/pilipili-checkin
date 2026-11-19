# Hachimi Daily Check-in for Surge iOS

一个小型、无依赖的 Surge iOS 模块：每天 09:05 检查并尝试签到 `mambo-hachimi.biliblili.uk`。这是独立第三方站点，**不是** `bilibili.com` 官方服务；使用前请自行评估是否信任该站点及其登录接口。

> **重要限制**：脚本及模拟测试均未使用真实账户登录，也没有对站点执行过任何认证请求。API 契约部分来自公开前端资源、部分为推断；请先审阅源代码并自行判断。测试通过只说明模拟行为符合预期，不代表线上站点已验证。

## 文件

- `HachimiCheckin.sgmodule` — Surge iOS 模块：每日 cron、手动运行入口、一次性 Setup 入口。
- `scripts/setup.js` — 从 Shortcuts 接收账号和密码，写入本机 Surge 持久化存储；`DELETE` 可清除本项目的凭据和令牌。
- `scripts/checkin.js` — 登录（首次/过期时）、读取签到状态，并至多提交一次签到。
- `test/checkin.test.js` — 使用 Node.js `vm` 和模拟 Surge 全局对象的离线测试，无第三方依赖。
- `LICENSE` — MIT。

## 发布后安装模块

仓库目前是本地审阅用项目；没有创建或推送 GitHub 仓库。模块中的远程路径预期为公开仓库 `yeah1z1/mambo-hachimi-checkin-surge` 的 `main` 分支，因此只有在你审阅后自行创建并发布到该路径时，以下 raw URL 才可用：

```text
https://raw.githubusercontent.com/yeah1z1/mambo-hachimi-checkin-surge/main/HachimiCheckin.sgmodule
```

1. 在 Surge iOS 中通过上面的 URL 安装模块，并启用 `Hachimi Daily Check-in` 模块。
2. 完成下节的一次性 Shortcuts 设置。启用 cron 后，脚本按设备/Surge 的本地日程每天 09:05 运行，`wake-system=true` 请求 Surge 在设备空闲时唤醒运行。
3. 若 GitHub 仓库名称或分支不同，先将 `.sgmodule` 中 3 个 `raw.githubusercontent.com/.../main/...` 路径一并改为实际公开 raw URL，再发布。

不用 MITM，不需要安装证书，也不需要 Surge MCP。

## 一次性保存账号（Apple Shortcuts）

账号/密码仅由快捷指令本次运行时输入，不要把它们写进模块、脚本、快捷指令固定文本、Git、问题日志或 URL。

1. 在「快捷指令」中新建快捷指令，添加两次 **询问输入（Ask for Input）**，输入类型选文本：第一次询问网站用户名；第二次询问网站密码。密码输入框是否遮蔽取决于 iOS Shortcuts 的行为，不要在他人可见的屏幕上输入。
2. 添加 **文本（Text）** 动作：第一行插入第一次询问得到的变量，换行后第二行插入密码变量。不要在变量前后添加额外空行。Setup 按第一个换行拆分；用户名会去除首尾空白，密码从分隔符后原样保留（包括标点及后续换行）。
3. 添加 Surge 的 **Run Script / 运行脚本** 快捷指令动作，选择 `Hachimi Setup`，把 Text 动作的结果作为脚本参数传入。
4. 运行一次。收到 `Hachimi Setup：已保存` 通知后，账号和密码已写入本机 `$persistentStore`，Setup 同时清除旧会话令牌。后续 cron 任务在首次运行或 GET 状态接口返回 401 时会用保存的账号密码重新登录。

更新密码时再次运行此快捷指令。若你的 iOS / Surge 版本中动作名称略有不同，请使用 Surge 提供的运行脚本 Shortcuts 动作，并将 Text 结果映射到脚本参数（即 `$intent.parameter`）。

### 删除本项目保存的数据

在同一个 Surge `Run Script` 动作中选择 `Hachimi Setup`，把参数改为单独的文本 `DELETE` 并运行。脚本调用 `$persistentStore.write(null, ...)` 删除本项目保存的账号、密码和会话令牌。该操作不删除 Surge 中其他数据。

## 手动运行与验证处理

- 在 Surge 脚本列表运行 `Hachimi Manual Check-in`，也可用 Shortcuts 的 Run Script 动作调用该脚本，不需要参数。
- `scripts/checkin.js` 先 GET `/api/checkin/status`；若显示今天已签到则结束，否则 POST `/api/checkin` 一次。
- 已保存会话的状态 GET 收到 401 时，最多重新登录一次并重读状态。签到 POST **从不自动重试**；若提交网络中断或结果不确定，通知用户手动打开网页核对。
- 遇到验证码、Turnstile、验证挑战、已知 HTML WAF 页面、重定向、403 或 429 时停止并通知用户手动处理。脚本不会获取/伪造验证令牌，不会尝试绕过 CAPTCHA 或挑战。
- 登录请求按已知前端形状发送 `verificationToken: null`；如果服务端要求实际验证令牌，脚本应停止，不会绕过。

## 凭据与请求安全

- 用户名/密码以 JSON 字符串保存在 Surge 的 `$persistentStore`，会话令牌也保存在同一存储。此存储是**本机持久化的明文存储，不是 Keychain**；不要将本项目用于共享/不受信任设备。Surge/iOS 的备份、设备访问和应用安全策略由用户自行评估。
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

测试覆盖成功签到、今日已签到、过期令牌的单次重登录、登录被拒、挑战拦截、签到 POST 网络错误不重试、Shortcut 凭据保存/清除，以及成功响应里 `verificationRequired:false` / `verificationToken:null` 不被误判为挑战。测试不会访问网络。

## 参考

- [Surge cron scripts](https://manual.nssurge.com/scripting/cron.md)
- [Surge JavaScript API（HTTP Client、Persistent Store、Notifications）](https://manual.nssurge.com/scripting/api.md)
- [Surge generic scripts / Shortcuts 参数](https://manual.nssurge.com/scripting/generic.md)
- [Surge scripting overview](https://manual.nssurge.com/scripting/overview.md)
- [Surge module format](https://manual.nssurge.com/profile/module.md)
