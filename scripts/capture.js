/* 捕获登录令牌：只在站点登录/刷新会话时保存 token，不输出、不修改响应。 */
(function () {
  "use strict";

  var TOKEN_KEY = "mambo_hachimi_token_v1";

  function pass() {
    try { $done({}); } catch (_) {}
  }

  try {
    var body = typeof $response === "object" && $response ? $response.body : "";
    if (typeof body !== "string" || !body) { pass(); return; }

    var json = null;
    try { json = JSON.parse(body); } catch (_) {}

    var token = json && typeof json.token === "string" ? json.token : null;
    if (!token || token.length < 20) { pass(); return; }

    var ok = false;
    try { ok = $persistentStore.write(token, TOKEN_KEY) === true; } catch (_) {}

    if (ok) {
      try {
        if (typeof $notification !== "undefined" && $notification && $notification.post) {
          $notification.post("pilipili签到：已获取登录令牌", "", "定时签到会使用该令牌，过期后重新打开站点登录一次即可。");
        }
      } catch (_) {}
    }
    pass();
  } catch (_) {
    pass();
  }
})();
