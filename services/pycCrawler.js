const axios = require("axios");
const cheerio = require("cheerio");
const config = require("../config/bm02");
const { createGateway } = require("./bm02Gateway.service");

function normalizePyc(pyc) {
  const match = String(pyc || "").trim().match(/(?:PENTEST\s*[-_]\s*)?(\d+)/i);
  if (!match) throw new Error(`Mã JIRA không hợp lệ: ${pyc}`);
  return match[1];
}

function extractTitle(html, pyc) {
  const $ = cheerio.load(String(html || ""));
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const expectedCode = new RegExp(`PENTEST\\s*[-_]\\s*${pyc}\\b`, "i");
  if (!title || !expectedCode.test(title)) {
    const error = new Error(`Không lấy được tên công việc của PENTEST-${pyc}`);
    // JC can occasionally return an incomplete/stale HTML page while several
    // lookups run together. Mark it retryable, but keep rejecting a wrong page.
    error.code = "E_PYC_TITLE";
    throw error;
  }
  return title;
}

function isTransientError(error) {
  return /E_PYC_TITLE|EACCES|ECONNABORTED|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(String(error?.code || "") + String(error?.message || ""));
}

function createPycCrawler({
  client = axios,
  baseUrl = config.jcBase,
  cookie = config.pycCookie,
  username = config.jcUsername,
  password = config.jcPassword,
  maxAttempts = 3,
  retryDelayMs = 500,
} = {}) {
  // Keep one gateway per crawler so concurrent lookups share the refreshed
  // session instead of every worker trying to log in independently.
  const gateway = createGateway({
    client,
    jcCookie: cookie,
    settings: {
      ...config,
      jcBase: baseUrl,
      jcUsername: username,
      jcPassword: password,
    },
  });

  return async function crawlPyc(pyc) {
    const number = normalizePyc(pyc);
    if (!cookie && (!username || !password)) {
      throw new Error("Chưa cấu hình cookie hoặc tài khoản PYC trên server.");
    }

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const html = await gateway.getIssue(number);
        return extractTitle(html, number);
      } catch (error) {
        lastError = error;
        if (!isTransientError(error) || attempt === maxAttempts) throw error;
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    throw lastError;
  };
}

const crawlPyc = createPycCrawler();

module.exports = crawlPyc;
module.exports.createPycCrawler = createPycCrawler;
module.exports.extractTitle = extractTitle;
module.exports.normalizePyc = normalizePyc;
module.exports.isTransientError = isTransientError;
