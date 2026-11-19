"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const checkinSource = fs.readFileSync(path.join(root, "scripts/checkin.js"), "utf8");
const captureSource = fs.readFileSync(path.join(root, "scripts/capture.js"), "utf8");
const TOKEN_KEY = "mambo_hachimi_token_v1";

// 测试内动态构造的虚构令牌，不含任何真实凭据。
function fakeToken() {
  return String.fromCharCode(116, 111, 107) + "-synthetic-" + "a".repeat(24);
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
  let doneResult;
  const persistentStore = {
    read(key) { return store.has(key) ? store.get(key) : null; },
    write(value, key) {
      if (value === null) store.delete(key);
      else if (typeof value === "string") store.set(key, value);
      else return false;
      return true;
    }
  };
  function send(method, opts, callback) {
    requests.push({ method, options: opts });
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
    $response: options.response,
    $done(result) { doneCount++; doneResult = result; }
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  return { store, requests, notices, doneCount, doneResult, remainingReplies: replies.length };
}

test("未捕获令牌：不发起请求，提示重新登录", () => {
  const r = execute(checkinSource, { store: new Map(), replies: [] });
  assert.equal(r.requests.length, 0);
  assert.match(r.notices[0].title, /需要重新登录/);
  assert.equal(r.doneCount, 1);
});

test("今日已签到：只读状态，不提交签到", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, { store, replies: [reply(200, { success: true, hasCheckedInToday: true })] });
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].method, "get");
  assert.equal(r.requests[0].options.url, "https://mambo-hachimi.biliblili.uk/api/checkin/status");
  assert.equal(r.requests[0].options.headers.Authorization, "Bearer " + fakeToken());
  assert.match(r.notices[0].title, /今日已完成/);
  assert.equal(r.doneCount, 1);
});

test("签到成功：只提交一次并报告奖励", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, {
    store,
    replies: [
      reply(200, { success: true, hasCheckedInToday: false }),
      reply(200, { success: true, amount: 3.15, currencyUnit: "STARRY" })
    ]
  });
  assert.deepEqual(r.requests.map(x => x.method), ["get", "post"]);
  assert.equal(r.requests[1].options.url, "https://mambo-hachimi.biliblili.uk/api/checkin");
  assert.equal(r.requests[1].options.body, "{}");
  assert.equal(r.requests[1].options["auto-redirect"], false);
  assert.match(r.notices[0].title, /签到成功/);
  assert.match(r.notices[0].body, /3\.15/);
  assert.equal(r.doneCount, 1);
});

test("令牌失效 401：清除令牌并提示重新登录，不重试", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, { store, replies: [reply(401, { message: "unauthorized" })] });
  assert.equal(r.requests.length, 1);
  assert.equal(store.has(TOKEN_KEY), false);
  assert.match(r.notices[0].title, /需要重新登录/);
  assert.equal(r.doneCount, 1);
});

test("签到要求人机验证：停止并提示手动处理，不重试提交", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, {
    store,
    replies: [
      reply(200, { success: true, hasCheckedInToday: false }),
      reply(403, { message: "人机验证失败，请重试" })
    ]
  });
  assert.equal(r.requests.length, 2);
  assert.match(r.notices[0].title, /需要手动处理/);
  assert.match(r.notices[0].body, /不会绕过验证/);
  assert.equal(r.doneCount, 1);
});

test("签到提交网络错误：不重试，提示手动核对", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, {
    store,
    replies: [reply(200, { success: true, hasCheckedInToday: false }), { error: "offline" }]
  });
  assert.deepEqual(r.requests.map(x => x.method), ["get", "post"]);
  assert.match(r.notices[0].title, /网络异常/);
  assert.match(r.notices[0].body, /不会重试提交/);
  assert.equal(r.doneCount, 1);
});

test("重复签到返回 400 hasCheckedIn：视为今日已完成", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, {
    store,
    replies: [
      reply(200, { success: true, hasCheckedInToday: false }),
      reply(400, { hasCheckedIn: true, amount: 3.15 })
    ]
  });
  assert.match(r.notices[0].title, /今日已完成/);
  assert.equal(r.doneCount, 1);
});

test("捕获脚本：登录响应中的令牌写入本机存储且不修改响应", () => {
  const store = new Map();
  const token = fakeToken();
  const r = execute(captureSource, {
    store,
    response: { status: 200, body: JSON.stringify({ token: token, user: { id: 1 } }) }
  });
  assert.equal(store.get(TOKEN_KEY), token);
  assert.equal(JSON.stringify(r.doneResult), "{}");
  assert.doesNotMatch(JSON.stringify(r.notices), new RegExp(token.slice(0, 10)));
});

test("捕获脚本：无 token 或过短内容不写入，也不打断请求", () => {
  const store = new Map();
  const a = execute(captureSource, { store, response: { status: 200, body: JSON.stringify({ success: true }) } });
  assert.equal(store.has(TOKEN_KEY), false);
  assert.equal(JSON.stringify(a.doneResult), "{}");

  const b = execute(captureSource, { store, response: { status: 200, body: JSON.stringify({ token: "short" }) } });
  assert.equal(store.has(TOKEN_KEY), false);

  const c = execute(captureSource, { store, response: { status: 502, body: "<html>bad gateway</html>" } });
  assert.equal(store.has(TOKEN_KEY), false);
  assert.equal(JSON.stringify(c.doneResult), "{}");
});

test("最坏两次请求在 60 秒超时预算内", () => {
  const store = new Map([[TOKEN_KEY, fakeToken()]]);
  const r = execute(checkinSource, {
    store,
    replies: [reply(200, { success: true, hasCheckedInToday: false }), reply(200, { success: true })]
  });
  assert.ok(r.requests.length * r.requests[0].options.timeout <= 60);
  assert.equal(r.doneCount, 1);
});
