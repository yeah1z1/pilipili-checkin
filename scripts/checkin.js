/* pilipili 网页签到：用 Surge 捕获的登录令牌读取状态并签到一次；不登录、不存密码。 */
(function () {
  "use strict";

  var BASE = "https://mambo-hachimi.biliblili.uk";
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

  function readToken() {
    try {
      var value = $persistentStore.read(TOKEN_KEY);
      return typeof value === "string" && value.length > 20 ? value : null;
    } catch (_) { return null; }
  }

  function clearToken() {
    try { $persistentStore.write(null, TOKEN_KEY); } catch (_) {}
  }

  function request(method, path, token, body, callback) {
    var headers = { "Accept": "application/json" };
    if (body !== null) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = "Bearer " + token;
    var options = {
      url: BASE + path,
      headers: headers,
      timeout: 20,
      "auto-redirect": false,
      "auto-cookie": false
    };
    if (body !== null) options.body = JSON.stringify(body);
    try {
      $httpClient[method](options, callback);
    } catch (_) {
      callback("request failed", null, null);
    }
  }

  function parseJSON(data) {
    if (typeof data !== "string") return null;
    try {
      var result = JSON.parse(data);
      return result && typeof result === "object" ? result : null;
    } catch (_) { return null; }
  }

  /* 只把明确的“需要人机验证/挑战”当作验证场景，避免误伤正常字段。 */
  function challengeLike(data, parsed, code) {
    var text = typeof data === "string" ? data : "";
    if (/^\s*<(?:!doctype\s+html|html\b|head\b|body\b)/i.test(text)) {
      return /cloudflare|cf-chl-|challenge-platform|turnstile|captcha|checking your browser|attention required/i.test(text);
    }
    if (!parsed || typeof parsed !== "object") return false;
    var failure = (typeof code === "number" && (code < 200 || code >= 300)) || parsed.success === false;
    if (!failure) return false;
    var msg = [parsed.message, parsed.error, parsed.detail, parsed.reason]
      .filter(function (v) { return typeof v === "string"; })
      .join(" ");
    return /captcha|turnstile|challenge|verification|verify|验证|人机/i.test(msg);
  }

  function manual(message) {
    finish("pilipili签到：需要手动处理", message || "站点要求验证或返回了非预期响应，请在浏览器手动签到。脚本不会绕过验证。");
  }

  function needsLogin() {
    clearToken();
    finish("pilipili签到：需要重新登录", "登录令牌不存在或已失效。请打开站点（App 或浏览器）登录一次，让 Surge 重新捕获令牌后再试。");
  }

  function networkFailure(isPost) {
    finish("pilipili签到：网络异常", isPost
      ? "签到提交结果无法确认。请手动核对网页状态；本脚本不会重试提交。"
      : "暂时无法连接站点，请检查网络后再运行。");
  }

  function responseStatus(response) {
    return response && typeof response.status === "number" ? response.status : 0;
  }

  function isBlocked(code) {
    return (code >= 300 && code < 400) || code === 403 || code === 429;
  }

  var token = readToken();
  if (!token) { needsLogin(); return; }

  function loadStatus() {
    request("get", "/api/checkin/status", token, null, function (error, response, data) {
      if (error || !response) { networkFailure(false); return; }
      var code = responseStatus(response);
      var parsed = parseJSON(data);
      if (code === 401) { needsLogin(); return; }
      if (challengeLike(data, parsed, code) || isBlocked(code)) { manual(); return; }
      if (code !== 200 || !parsed || parsed.success !== true || typeof parsed.hasCheckedInToday !== "boolean") {
        if (!parsed) manual("签到状态接口返回非 JSON 响应，请在浏览器手动核对。");
        else finish("pilipili签到：状态读取失败", "站点返回了无法识别的签到状态；未提交签到请求。");
        return;
      }
      if (parsed.hasCheckedInToday) {
        finish("pilipili签到：今日已完成", "站点显示今天已经签到，无需再次提交。");
        return;
      }
      submitCheckin();
    });
  }

  function submitCheckin() {
    request("post", "/api/checkin", token, {}, function (error, response, data) {
      if (error || !response) { networkFailure(true); return; }
      var code = responseStatus(response);
      var parsed = parseJSON(data);
      if (challengeLike(data, parsed, code)) {
        manual("签到需要人机验证。请在浏览器手动签到一次；本脚本不会绕过验证，也不会重试提交。");
        return;
      }
      if (isBlocked(code)) { manual(); return; }
      if (code === 401) {
        clearToken();
        finish("pilipili签到：令牌失效", "签到请求未获授权。本次不重试；请重新登录站点后再运行。");
        return;
      }
      if (code === 400 && parsed && parsed.hasCheckedIn === true) {
        finish("pilipili签到：今日已完成", "站点报告今天已经签到，无需再次提交。");
        return;
      }
      if (code === 200 && parsed && parsed.success === true) {
        var amount = parsed.amount;
        var unit = parsed.currencyUnit ? " " + parsed.currencyUnit : "";
        finish("pilipili签到成功", amount === undefined ? "站点已确认今日签到完成。" : "本次获得 " + amount + unit + "。");
        return;
      }
      if (!parsed) {
        manual("签到接口返回非 JSON 响应，请手动核对网页状态；本脚本不会重试提交。");
        return;
      }
      finish("pilipili签到：结果未确认", "站点未确认签到成功。请手动核对网页状态；本脚本不会重试提交。");
    });
  }

  loadStatus();
})();
