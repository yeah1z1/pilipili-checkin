/* 一次性 Shortcut 输入：用户名换行密码；DELETE 清除本项目凭据及令牌。 */
(function () {
  "use strict";

  var CREDENTIALS_KEY = "mambo_hachimi_credentials_v1";
  var TOKEN_KEY = "mambo_hachimi_token_v1";
  var finished = false;

  function finish(title, message) {
    if (finished) return;
    finished = true;
    try {
      if (typeof $notification !== "undefined" && $notification && $notification.post) {
        $notification.post(title, "", message);
      }
    } catch (_) {}
    try { $done(); } catch (_) {}
  }

  /* 优先用快捷指令传入的参数；没有时回退到模块参数界面填写的值。 */
  function fromArgument() {
    var raw = typeof $argument === "string" ? $argument : "";
    if (!raw) return null;
    var marker = "&password=";
    var index = raw.indexOf(marker);
    if (index < 0) return null;
    var user = raw.slice(0, index);
    if (user.indexOf("username=") === 0) user = user.slice(9);
    var pass = raw.slice(index + marker.length);
    user = user.trim();
    if (!user || !pass) return null;
    if (user === "USERNAME_HERE" || pass === "PASSWORD_HERE") return null;
    return user + "\n" + pass;
  }

  var parameter = typeof $intent !== "undefined" && $intent && typeof $intent.parameter === "string"
    ? $intent.parameter : fromArgument();
  if (parameter === "DELETE") {
    try {
      var credentialsCleared = $persistentStore.write(null, CREDENTIALS_KEY);
      var tokenCleared = $persistentStore.write(null, TOKEN_KEY);
      if (credentialsCleared === false || tokenCleared === false) {
        finish("Hachimi：清除未确认", "Surge 未确认所有数据已清除；请在 Surge 脚本环境重试。");
      } else {
        finish("Hachimi：本机数据已清除", "已请求删除本项目保存的账号、密码与会话令牌。");
      }
    } catch (_) {
      finish("Hachimi：清除失败", "无法访问 Surge 持久化存储，请在 Surge 脚本环境重试。");
    }
    return;
  }

  if (parameter === null) {
    finish("Hachimi Setup：缺少输入", "请在模块「编辑参数」填写账号密码，或从快捷指令传入「账号换行密码」；删除数据时传入 DELETE。");
    return;
  }

  var separator = parameter.indexOf("\n");
  if (separator < 0) {
    finish("Hachimi Setup：输入格式错误", "需要两行输入：第一行为用户名，第二行起为密码。");
    return;
  }
  var username = parameter.slice(0, separator).replace(/\r$/, "").trim();
  var password = parameter.slice(separator + 1);
  if (!username || !password) {
    finish("Hachimi Setup：输入格式错误", "用户名和密码都不能为空；密码会原样保存，请勿在前后额外添加换行。");
    return;
  }

  try {
    var saved = $persistentStore.write(JSON.stringify({ username: username, password: password }), CREDENTIALS_KEY);
    if (saved !== true) {
      finish("Hachimi Setup：保存失败", "Surge 未确认账号数据已保存，请检查 Surge 后重试。");
      return;
    }
    $persistentStore.write(null, TOKEN_KEY);
    finish("Hachimi Setup：已保存", "账号数据仅写入本机 Surge 持久化存储；现在可以运行每日签到脚本。");
  } catch (_) {
    finish("Hachimi Setup：保存失败", "无法访问 Surge 持久化存储，请检查 Surge 后重试。");
  }
})();
