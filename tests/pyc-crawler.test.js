const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPycCrawler, extractTitle, normalizePyc } = require("../services/pycCrawler");

test("PYC crawler posts the numeric code to /jc/ with the configured session cookie", async () => {
  let call;
  const crawler = createPycCrawler({
    baseUrl: "http://jc.test",
    cookie: "session=active",
    client: {
      post: async (url, body, options) => {
        call = { url, body, options };
        return { status: 200, data: "<title>PENTEST-20134: Công việc</title>" };
      },
    },
  });

  assert.equal(await crawler("PENTEST-20134"), "PENTEST-20134: Công việc");
  assert.equal(call.url, "http://jc.test/jc/");
  assert.equal(call.body, "pyc=20134");
  assert.equal(call.options.headers.Cookie, "session=active");
  assert.equal(call.options.headers.Referer, "http://jc.test/jc/");
});

test("PYC crawler refreshes an expired session after the JC login redirect", async () => {
  const calls = [];
  const crawler = createPycCrawler({
    baseUrl: "http://jc.test",
    cookie: "session=expired",
    username: "lookup-user",
    password: "lookup-secret",
    client: {
      post: async (url, body, options) => {
        calls.push({ url, body, cookie: options.headers.Cookie });
        if (calls.length === 1) {
          return {
            status: 302,
            headers: {
              location: "/jc/login?next=%2Fjc%2F",
              "set-cookie": ["session=; Max-Age=0"],
            },
          };
        }
        if (url.includes("/jc/login")) {
          assert.equal(body, "username=lookup-user&password=lookup-secret");
          return {
            status: 302,
            headers: { location: "/jc/", "set-cookie": ["session=fresh; HttpOnly"] },
          };
        }
        assert.equal(body, "pyc=21003");
        assert.equal(options.headers.Cookie, "session=fresh");
        return { status: 200, data: "<title>PENTEST-21003: Công việc mới</title>" };
      },
    },
  });

  assert.equal(await crawler("PENTEST-21003"), "PENTEST-21003: Công việc mới");
  assert.equal(calls.length, 3);
});

test("concurrent PYC lookups share one session refresh", async () => {
  let logins = 0;
  const crawler = createPycCrawler({
    baseUrl: "http://jc.test",
    cookie: "session=expired",
    username: "lookup-user",
    password: "lookup-secret",
    client: {
      post: async (url, body, options) => {
        if (url.includes("/jc/login")) {
          logins += 1;
          await new Promise(resolve => setTimeout(resolve, 5));
          return {
            status: 302,
            headers: { location: "/jc/", "set-cookie": ["session=fresh; HttpOnly"] },
          };
        }
        if (!options.headers.Cookie.includes("session=fresh")) {
          return { status: 302, headers: { location: "/jc/login?next=%2Fjc%2F" } };
        }
        const pyc = new URLSearchParams(body).get("pyc");
        return { status: 200, data: `<title>PENTEST-${pyc}: Công việc</title>` };
      },
    },
  });

  assert.deepEqual(await Promise.all([crawler("21003"), crawler("21004"), crawler("21075")]), [
    "PENTEST-21003: Công việc",
    "PENTEST-21004: Công việc",
    "PENTEST-21075: Công việc",
  ]);
  assert.equal(logins, 1);
});

test("PYC crawler rejects a response that is not the requested PYC", () => {
  assert.equal(normalizePyc("pentest_20561"), "20561");
  assert.throws(() => normalizePyc("ABC"), /Mã JIRA không hợp lệ/);
  assert.throws(() => extractTitle("<title>Lỗi - Tool Support OS</title>", "20134"), /Không lấy được tên công việc/);
});

test("PYC crawler retries transient connection errors", async () => {
  let calls = 0;
  const crawler = createPycCrawler({
    cookie: "session=active",
    retryDelayMs: 0,
    client: {
      post: async () => {
        calls += 1;
        if (calls < 3) {
          const error = new Error("blocked");
          error.code = "EACCES";
          throw error;
        }
        return { status: 200, data: "<title>PENTEST-20487: Công việc</title>" };
      },
    },
  });
  assert.equal(await crawler("20487"), "PENTEST-20487: Công việc");
  assert.equal(calls, 3);
});

test("PYC crawler retries an incomplete JC page and still validates the requested code", async () => {
  let calls = 0;
  const crawler = createPycCrawler({
    cookie: "session=active",
    retryDelayMs: 0,
    client: {
      post: async () => {
        calls += 1;
        if (calls === 1) return { status: 200, data: "<title>Tool Support OS</title>" };
        return { status: 200, data: "<title>PENTEST-21836: Công việc</title>" };
      },
    },
  });

  assert.equal(await crawler("21836"), "PENTEST-21836: Công việc");
  assert.equal(calls, 2);
});
