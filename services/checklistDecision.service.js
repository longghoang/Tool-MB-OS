const fs = require("fs");
const path = require("path");

const apiChecklist = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../checklist/api.json"))
);
const featureChecklist = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../checklist/feature.json"))
);
const globalChecklist = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../checklist/global.json"))
);

// ===== INIT =====
function initChecklist(list) {
  return list.map(item => ({
    ...item,
    needTest: false,
    result: null
  }));
}

function buildChecklistTemplate() {
  return {
    api: initChecklist(apiChecklist),
    feature: initChecklist(featureChecklist),
    global: initChecklist(globalChecklist)
  };
}

// ===== MARK BY CODE PREFIX =====
function mark(list, prefixes) {
  list.forEach(i => {
    if (!i.code) return;
    if (prefixes.some(p => i.code.startsWith(p))) {
      i.needTest = true;
    }
  });
}

// ===== MARK BY TASK KEYWORD =====
function markByTask(list, keywords) {
  list.forEach(i => {
    if (
      i.task &&
      keywords.some(k => i.task.toLowerCase().includes(k.toLowerCase()))
    ) {
      i.needTest = true;
    }
  });
}

// ===== MAIN LOGIC =====
function decideChecklist(apiProfiles) {
  const { api, feature, global } = buildChecklistTemplate();

  for (const a of apiProfiles) {

    /**
     * ==================================================
     * AUTHENTICATION – CHỈ LOGIN FLOW MỚI ĐƯỢC TEST
     * ==================================================
     */
    if (["login", "forgot-password", "reset-password"].includes(a.endpointType)) {
      mark(feature, ["OTG-AUTHN", "MFA-"]);

      markByTask(api, [
        "default password",
        "weak password",
        "password policy",
        "remember me",
        "security question",
        "reset password",
        "credential"
      ]);
    }

    /**
     * ==================================================
     * STATELESS AUTH – BEARER / JWT / OAUTH2
     * ==================================================
     */
    if (a.authType === "bearer") {
      // ❌ KHÔNG test session / cookie
      // ✅ test quyền + token logic
      mark(feature, ["OTG-AUTHZ", "MFA-"]);

      markByTask(api, [
        "missing token",
        "invalid token",
        "expired token",
        "jwt",
        "scope",
        "role",
        "refresh token"
      ]);
    }

    /**
     * ==================================================
     * STATEFUL SESSION – COOKIE BASED
     * ==================================================
     */
    if (a.authType === "cookie") {
      mark(api, ["OTG-SESS"]);

      // CSRF chỉ có ý nghĩa với cookie + write
      if (a.isWriteMethod) {
        markByTask(api, ["csrf", "cross site request forgery"]);
      }
    }

    /**
     * ==================================================
     * INPUT VALIDATION / INJECTION
     * ==================================================
     */
    if (a.hasUserInput) {
      mark(api, ["OTG-INPVAL"]);

      // SQL theo backend DB (nếu biết)
      if (a.backendDB === "oracle") {
        mark(api, ["OTG-INPVAL-005-ORACLE"]);
      }
      if (a.backendDB === "mssql") {
        mark(api, ["OTG-INPVAL-005-MSSQL"]);
      }
      if (a.backendDB === "postgres") {
        mark(api, ["OTG-INPVAL-006"]);
      }
      if (a.backendDB === "msaccess") {
        mark(api, ["OTG-INPVAL-005-MSACCESS"]);
      }

      markByTask(api, [
        "sql injection",
        "nosql",
        "command injection",
        "code injection"
      ]);
    }

    /**
     * ==================================================
     * ACCESS CONTROL
     * ==================================================
     */
    if (a.hasAuthHeader) {
      mark(feature, ["OTG-AUTHZ", "MFA-", "DATA-"]);
    }

    /**
     * ==================================================
     * MEMORY CORRUPTION (HIẾM – CHỈ KHI C/C++)
     * ==================================================
     */
    if (
      a.techStack?.includes("c") ||
      a.techStack?.includes("cpp") ||
      a.isBinaryInterface
    ) {
      mark(api, ["OTG-INPVAL-015", "OTG-INPVAL-020"]); // stack / heap overflow
    }

    /**
     * ==================================================
     * FILE UPLOAD / FILE CONFIG
     * ==================================================
     */
    if (a.isFileUpload) {
      mark(feature, ["OTG-BUSLOGIC"]);
      markByTask(api, ["upload", "file inclusion"]);
    }

    if (a.url?.toLowerCase().includes("graphql")) {
      mark(feature, ["OTG-APIT-01"]);
    }

    if (
      a.isFileUpload ||
      a.url?.match(/\.(bak|old|backup|zip|conf|env)$/i)
    ) {
      mark(global, ["OTG-CONFIG-003", "OTG-CONFIG-004"]);
    }

    /**
     * ==================================================
     * CLIENT SIDE (READ ONLY)
     * ==================================================
     */
    if (a.isReadMethod) {
      mark(api, ["OTG-CLIENT"]);
    }

    /**
     * ==================================================
     * PARTNER / WEBHOOK / INTEGRATION
     * ==================================================
     */
    if (
      a.url?.toLowerCase().includes("partner") ||
      a.url?.toLowerCase().includes("integration") ||
      a.url?.toLowerCase().includes("webhook")
    ) {
      mark(feature, ["OTG-AUTHZ", "OTG-BUSLOGIC"]);
      mark(global, ["INFO-MB-02"]);
    }

    /**
     * ==================================================
     * TRANSPORT LAYER – CHỈ QUAN TÂM CLEAR-TEXT
     * ==================================================
     */
    if (a.url?.startsWith("http://")) {
      mark(global, ["OTG-CRYPST-003"]); // sensitive data over cleartext
    }
  }

  /**
   * ==================================================
   * GLOBAL BASELINE – LUÔN CÓ
   * ==================================================
   */
  mark(global, ["OTG-INFO", "OTG-CONFIG", "OTG-ERR", "INFO-MB"]);
  mark(feature, ["OTG-BUSLOGIC", "PAY-", "DATA-", "TXN-"]);

  return { api, feature, global };
}

module.exports = { decideChecklist, buildChecklistTemplate };
