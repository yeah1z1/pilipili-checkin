/* Hachimi 网页签到：仅请求固定站点 API；不输出账号、密码或令牌。 */
(function () {
  "use strict";

  var BASE = "https://mambo-hachimi.biliblili.uk";
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

  function readCredentials() {
    try {
      var raw = $persistentStore.read(CREDENTIALS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.username !== "string" || !parsed.username ||
          typeof parsed.password !== "string" || !parsed.password) return null;
      return { username: parsed.username, password: parsed.password };
    } catch (_) { return null; }
  }

  function readToken() {
    try {
      var value = $persistentStore.read(TOKEN_KEY);
      return typeof value === "string" && value.length ? value : null;
    } catch (_) { return null; }
  }

  function saveToken(value) {
    try { return $persistentStore.write(value, TOKEN_KEY) === true; }
    catch (_) { return false; }
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
      timeout: 15,
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

  function challengeLike(data, parsed, response, code) {
    var text = typeof data === "string" ? data : "";
    var isHTML = /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text);
    var contentType = "";
    var responseHeaders = response && response.headers;
    if (responseHeaders && typeof responseHeaders === "object") {
      Object.keys(responseHeaders).some(function (key) {
        if (key.toLowerCase() === "content-type") {
          contentType = String(responseHeaders[key] || "");
          return true;
        }
        return false;
      });
    }
    isHTML = isHTML || /text\/html/i.test(contentType);
    if (isHTML) {
      return /cloudflare|cf-chl-|challenge-platform|turnstile|captcha|checking your browser|attention required|access denied/i.test(text);
    }
    if (!parsed || typeof parsed !== "object") return false;

    var failure = (typeof code === "number" && (code < 200 || code >= 300)) || parsed.success === false;
    var flagNames = {
      captcha: 1, captcharequired: 1, captchaneeded: 1, captchaenabled: 1,
      turnstile: 1, turnstilerequired: 1, turnstileneeded: 1,
      challenge: 1, challengerequired: 1, challengeneeded: 1,
      verificationrequired: 1, verifyrequired: 1,
      requiresverification: 1, requirescaptcha: 1, needverification: 1, needscaptcha: 1,
      ischallenge: 1
    };
    var messageNames = { message: 1, error: 1, detail: 1, reason: 1, description: 1, title: 1 };
    var messagePattern = /captcha|turnstile|challenge|verification|verify|验证码|人机验证|安全验证|请完成验证|cf-chl-/i;
    var seen = 0;
    function inspect(value, parentKey) {
      if (seen++ > 100 || value == null) return false;
      if (Array.isArray(value)) return value.some(function (item) { return inspect(item, parentKey); });
      if (typeof value !== "object") return false;
      var keys = Object.keys(value);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], item = value[key];
        var normalized = key.toLowerCase().replace(/[-_]/g, "");
        if (flagNames[normalized]) {
          if (item === true || item === 1 ||
              (typeof item === "string" && /^(?:true|1|yes|required|needed|challenge|captcha|turnstile)$/i.test(item.trim()))) return true;
          if ((normalized === "captcha" || normalized === "turnstile" || normalized === "challenge") &&
              item && typeof item === "object" && Object.keys(item).length > 0) return true;
        }
        if (failure && messageNames[normalized] && typeof item === "string" && messagePattern.test(item)) return true;
        if (inspect(item, key)) return true;
      }
      return false;
    }
    return inspect(parsed, "");
  }

  function manual(message) {
    finish("Hachimi 签到：需要手动处理", message || "站点要求验证或返回了非预期响应。请在浏览器手动登录/签到；本脚本不会绕过验证。");
  }

  function networkFailure(isPost) {
    finish("Hachimi 签到：网络异常", isPost
      ? "签到提交结果无法确认。请手动核对网页状态；本脚本不会重试提交。"
      : "暂时无法连接站点，请检查网络后再运行。");
  }

  function responseStatus(response) {
    return response && typeof response.status === "number" ? response.status : 0;
  }

  function isRedirectOrBlocked(code) {
    return (code >= 300 && code < 400) || code === 403 || code === 429;
  }

  var credentials = readCredentials();
  if (!credentials) {
    finish("Hachimi 签到：尚未设置", "请先运行一次 Hachimi Setup 快捷指令保存账号；不要把密码写入模块或脚本。");
    return;
  }

  function login(callback) {
    request("post", "/api/auth/login", null, {
      userName: credentials.username,
      password: credentials.password,
      rememberMe: false,
      verificationToken: null
    }, function (error, response, data) {
      if (error || !response) { networkFailure(false); return; }
      var code = responseStatus(response);
      var parsed = parseJSON(data);
      if (challengeLike(data, parsed, response, code) || isRedirectOrBlocked(code)) { manual(); return; }
      if (code === 401) {
        finish("Hachimi 签到：登录失败", "账号或密码可能不正确。请检查后重新运行一次设置快捷指令。");
        return;
      }
      if (code !== 200 || !parsed || parsed.success === false || typeof parsed.token !== "string" || !parsed.token) {
        if (!parsed) manual("登录接口返回非 JSON 响应。请在浏览器手动登录/签到；本脚本不会绕过验证。");
        else finish("Hachimi 签到：登录失败", "登录接口未返回可用会话。请在浏览器手动检查账号状态。");
        return;
      }
      if (!saveToken(parsed.token)) {
        finish("Hachimi 签到：无法保存会话", "Surge 持久化存储写入失败；请检查 Surge 后重试。");
        return;
      }
      callback(parsed.token);
    });
  }

  function loadStatus(token, recovered401) {
    request("get", "/api/checkin/status", token, null, function (error, response, data) {
      if (error || !response) { networkFailure(false); return; }
      var code = responseStatus(response);
      var parsed = parseJSON(data);
      if (challengeLike(data, parsed, response, code) || isRedirectOrBlocked(code)) { manual(); return; }
      if (code === 401) {
        if (!recovered401) {
          clearToken();
          login(function (newToken) { loadStatus(newToken, true); });
        } else {
          clearToken();
          finish("Hachimi 签到：会话失效", "重新登录后站点仍拒绝会话。请在浏览器手动登录并检查账号状态。");
        }
        return;
      }
      if (code !== 200 || !parsed || parsed.success !== true || typeof parsed.hasCheckedInToday !== "boolean") {
        if (!parsed) manual("签到状态接口返回非 JSON 响应。请在浏览器手动登录/签到；本脚本不会绕过验证。");
        else finish("Hachimi 签到：状态读取失败", "站点返回了无法识别的签到状态；未提交签到请求。");
        return;
      }
      if (parsed.hasCheckedInToday) {
        finish("Hachimi 签到：今日已完成", "站点显示今天已经签到，无需再次提交。");
        return;
      }
      submitCheckin(token);
    });
  }

  function submitCheckin(token) {
    request("post", "/api/checkin", token, {}, function (error, response, data) {
      if (error || !response) { networkFailure(true); return; }
      var code = responseStatus(response);
      var parsed = parseJSON(data);
      if (challengeLike(data, parsed, response, code) || isRedirectOrBlocked(code)) { manual(); return; }
      if (code === 400 && parsed && parsed.hasCheckedIn === true) {
        finish("Hachimi 签到：今日已完成", "站点报告今天已经签到，无需再次提交。");
        return;
      }
      if (code === 200 && parsed && parsed.success === true) {
        finish("Hachimi 签到成功", "站点已确认今日签到完成。");
        return;
      }
      if (code === 401) {
        clearToken();
        finish("Hachimi 签到：会话失效", "签到请求未获授权。本次不会重试提交，请手动核对网页状态；下次运行将重新登录。");
        return;
      }
      if (!parsed) {
        manual("签到接口返回非 JSON 响应。请手动核对网页状态；本脚本不会重试提交。");
        return;
      }
      finish("Hachimi 签到：结果未确认", "站点未确认签到成功。请手动核对网页状态；本脚本不会重试提交。");
    });
  }

  var token = readToken();
  if (token) loadStatus(token, false);
  else login(function (newToken) { loadStatus(newToken, false); });
})();
