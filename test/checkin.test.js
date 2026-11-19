"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const checkinSource = fs.readFileSync(path.join(root, "scripts/checkin.js"), "utf8");
const setupSource = fs.readFileSync(path.join(root, "scripts/setup.js"), "utf8");
const CREDENTIALS_KEY = "mambo_hachimi_credentials_v1";
const TOKEN_KEY = "mambo_hachimi_token_v1";

// 仅在测试运行期间构造虚构数据，不包含真实账户或密码。
function syntheticPair() {
  return {
    username: String.fromCharCode(117, 110, 105, 116, 45, 117, 115, 101, 114),
    password: String.fromCharCode(112, 119, 45, 116, 101, 115, 116)
  };
}
function seedCredentials(store) {
  const pair = syntheticPair();
  store.set(CREDENTIALS_KEY, JSON.stringify(pair));
  return pair;
}
function reply(status, body) {
  return { response: { status }, data: JSON.stringify(body) };
}
function execute(source, options = {}) {
  const store = options.store || new Map();
  const replies = (options.replies || []).slice();
  const requests = [];
  const notices = [];
  let doneCount = 0;
  const persistentStore = {
    read(key) { return store.has(key) ? store.get(key) : null; },
    write(value, key) {
      if (value === null) store.delete(key);
      else if (typeof value === "string") store.set(key, value);
      else return false;
      return true;
    }
  };
  function send(method, options, callback) {
    requests.push({ method, options });
    const next = replies.shift();
    if (!next) throw new Error("Unexpected request in test mock");
    callback(next.error || null, next.response || null, next.data == null ? null : next.data);
  }
  const context = {
    $persistentStore: persistentStore,
    $notification: { post(title, subtitle, body) { notices.push({ title, subtitle, body }); } },
    $httpClient: {
      get(options, callback) { send("get", options, callback); },
      post(options, callback) { send("post", options, callback); }
    },
    $done() { doneCount++; },
    $argument: options.argument,
    $intent: options.intent ? { parameter: options.intent } : undefined
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  return { store, requests, notices, doneCount, remainingReplies: replies.length };
}
function runCheckin(options) { return execute(checkinSource, options); }
function runSetup(options) { return execute(setupSource, options); }
function bodyOf(request) { return JSON.parse(request.options.body); }

test("签到成功：先读取状态，再仅提交一次签到", () => {
  const store = new Map();
  seedCredentials(store);
  store.set(TOKEN_KEY, "synthetic-session-token");
  const result = runCheckin({ store, replies: [
    reply(200, { success: true, hasCheckedInToday: false }),
    reply(200, { success: true, amount: 1, currencyUnit: "test" })
  ] });
  assert.deepEqual(result.requests.map(r => r.method), ["get", "post"]);
  assert.equal(result.requests[0].options.url, "https://mambo-hachimi.biliblili.uk/api/checkin/status");
  assert.equal(result.requests[0].options.headers.Authorization, "Bearer synthetic-session-token");
  assert.equal(result.requests[1].options.url, "https://mambo-hachimi.biliblili.uk/api/checkin");
  assert.equal(result.requests[1].options.body, "{}");
  assert.equal(result.requests[1].options["auto-redirect"], false);
  assert.equal(result.requests[1].options["auto-cookie"], false);
  assert.equal(result.requests[0].options.timeout, 15);
  assert.equal(result.doneCount, 1);
  assert.match(result.notices[0].title, /签到成功/);
  assert.equal(result.remainingReplies, 0);
});

test("今日已签到：不调用签到提交接口", () => {
  const store = new Map();
  seedCredentials(store);
  store.set(TOKEN_KEY, "synthetic-session-token");
  const result = runCheckin({ store, replies: [reply(200, { success: true, hasCheckedInToday: true })] });
  assert.equal(result.requests.length, 1);
  assert.match(result.notices[0].title, /今日已完成/);
  assert.equal(result.doneCount, 1);
});

test("过期会话：401 后只登录一次并重读状态", () => {
  const store = new Map();
  seedCredentials(store);
  store.set(TOKEN_KEY, "expired-session-token");
  const result = runCheckin({ store, replies: [
    reply(401, { message: "expired" }),
    reply(200, { token: "renewed-session-token", user: {} }),
    reply(200, { success: true, hasCheckedInToday: false }),
    reply(200, { success: true })
  ] });
  assert.deepEqual(result.requests.map(r => r.method), ["get", "post", "get", "post"]);
  const login = bodyOf(result.requests[1]);
  assert.equal(typeof login.userName, "string");
  assert.equal(typeof login.password, "string");
  assert.equal(login.rememberMe, false);
  assert.equal(login.verificationToken, null);
  assert.equal(result.requests[2].options.headers.Authorization, "Bearer renewed-session-token");
  assert.equal(store.get(TOKEN_KEY), "renewed-session-token");
  assert.equal(result.doneCount, 1);
});

test("登录凭据被拒：不请求状态或签到", () => {
  const store = new Map();
  seedCredentials(store);
  const result = runCheckin({ store, replies: [reply(401, { message: "invalid login" })] });
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].options.url, "https://mambo-hachimi.biliblili.uk/api/auth/login");
  assert.match(result.notices[0].title, /登录失败/);
  assert.equal(result.doneCount, 1);
});

test("验证挑战：停止并通知，不提交签到", () => {
  const store = new Map();
  seedCredentials(store);
  const result = runCheckin({ store, replies: [reply(403, { message: "Turnstile challenge required" })] });
  assert.equal(result.requests.length, 1);
  assert.match(result.notices[0].title, /手动处理/);
  assert.match(result.notices[0].body, /不会绕过验证/);
  assert.equal(result.doneCount, 1);
});

test("签到提交网络错误：只提交一次并说明结果需手动核对", () => {
  const store = new Map();
  seedCredentials(store);
  store.set(TOKEN_KEY, "synthetic-session-token");
  const result = runCheckin({ store, replies: [
    reply(200, { success: true, hasCheckedInToday: false }),
    { error: "offline" }
  ] });
  assert.deepEqual(result.requests.map(r => r.method), ["get", "post"]);
  assert.match(result.notices[0].title, /网络异常/);
  assert.match(result.notices[0].body, /不会重试提交/);
  assert.equal(result.doneCount, 1);
});

test("Shortcut 设置接受首个换行分隔并原样保存密码，再由 DELETE 清除", () => {
  const store = new Map();
  const pair = syntheticPair();
  const multilinePassword = pair.password + "\n" + String.fromCharCode(120, 121, 122);
  store.set(TOKEN_KEY, "old-session-token");
  const setup = runSetup({ store, intent: pair.username + "\n" + multilinePassword });
  const saved = JSON.parse(store.get(CREDENTIALS_KEY));
  assert.equal(saved.username, pair.username);
  assert.equal(saved.password, multilinePassword);
  assert.equal(store.has(TOKEN_KEY), false);
  assert.equal(setup.doneCount, 1);
  assert.doesNotMatch(JSON.stringify(setup.notices), /unit-user|pw-test/);

  store.set(TOKEN_KEY, "old-session-token");
  const cleared = runSetup({ store, intent: "DELETE" });
  assert.equal(store.has(CREDENTIALS_KEY), false);
  assert.equal(store.has(TOKEN_KEY), false);
  assert.equal(cleared.doneCount, 1);
});

test("成功响应中 verificationRequired:false 和 verificationToken:null 不触发验证拦截", () => {
  const store = new Map();
  seedCredentials(store);
  const result = runCheckin({ store, replies: [
    reply(200, { token: "synthetic-session-token", user: {}, verificationRequired: false, verificationToken: null }),
    reply(200, { success: true, hasCheckedInToday: true, verificationRequired: false, verificationToken: null })
  ] });
  assert.deepEqual(result.requests.map(r => r.method), ["post", "get"]);
  assert.match(result.notices[0].title, /今日已完成/);
  assert.equal(result.doneCount, 1);
});
test("最坏 4 次串行请求均在 90 秒模块超时预算内", () => {
  const store = new Map();
  seedCredentials(store);
  store.set(TOKEN_KEY, "expired-session-token");
  const result = runCheckin({ store, replies: [
    reply(401, { message: "expired" }),
    reply(200, { token: "renewed-session-token", user: {} }),
    reply(200, { success: true, hasCheckedInToday: false }),
    reply(200, { success: true })
  ] });
  const perRequest = result.requests[0].options.timeout;
  assert.equal(perRequest, 15);
  assert.ok(result.requests.length * perRequest <= 90,
    `${result.requests.length} 请求 × ${perRequest}s 应不超过 90s`);
  assert.equal(result.doneCount, 1);
});

test("模块参数：$argument 中的账号密码优先，密码内的 & 与 = 原样保留", () => {
  const store = new Map();
  const pair = syntheticPair();
  const rawPassword = "pw&fake=" + pair.password;
  const result = runCheckin({
    store,
    argument: "username=" + pair.username + "&password=" + rawPassword,
    replies: [
      reply(200, { token: "parameter-session-token", user: {} }),
      reply(200, { success: true, hasCheckedInToday: true })
    ]
  });
  const login = bodyOf(result.requests[0]);
  assert.equal(result.requests[0].options.url, "https://mambo-hachimi.biliblili.uk/api/auth/login");
  assert.equal(login.userName, pair.username);
  assert.equal(login.password, rawPassword);
  assert.equal(store.get(TOKEN_KEY), "parameter-session-token");
  assert.doesNotMatch(JSON.stringify(result.notices), /unit-user|pw-test|pw&fake/);
  assert.equal(result.doneCount, 1);
});

test("模块参数为空时回退到本机已保存的凭据", () => {
  const store = new Map();
  const pair = seedCredentials(store);
  store.set(TOKEN_KEY, "stored-session-token");
  const result = runCheckin({
    store,
    argument: "username=&password=",
    replies: [reply(200, { success: true, hasCheckedInToday: true })]
  });
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].options.headers.Authorization, "Bearer stored-session-token");
  assert.match(result.notices[0].title, /今日已完成/);
  assert.equal(result.doneCount, 1);
  assert.equal(typeof pair.username, "string");
});

test("模块参数与本机存储都没有凭据：提示去编辑模块参数", () => {
  const result = runCheckin({ store: new Map(), replies: [] });
  assert.equal(result.requests.length, 0);
  assert.match(result.notices[0].title, /尚未设置/);
  assert.match(result.notices[0].body, /编辑参数/);
  assert.equal(result.doneCount, 1);
});

test("Setup 可从模块参数读取并保存，且不回显凭据", () => {
  const store = new Map();
  const pair = syntheticPair();
  const rawPassword = pair.password + "&=,tail";
  const setup = execute(setupSource, {
    store,
    argument: "username=" + pair.username + "&password=" + rawPassword
  });
  const saved = JSON.parse(store.get(CREDENTIALS_KEY));
  assert.equal(saved.username, pair.username);
  assert.equal(saved.password, rawPassword);
  assert.equal(setup.doneCount, 1);
  assert.doesNotMatch(JSON.stringify(setup.notices), /unit-user|pw-test/);
});

test("模块参数仍是占位符时视为未填写，不发起登录", () => {
  const result = runCheckin({
    store: new Map(),
    argument: "username=USERNAME_HERE&password=PASSWORD_HERE",
    replies: []
  });
  assert.equal(result.requests.length, 0);
  assert.match(result.notices[0].title, /尚未设置/);
  assert.equal(result.doneCount, 1);
});
