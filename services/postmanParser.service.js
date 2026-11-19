const fs = require("fs");


function analyzePostman(postmanJson) {
  if (!postmanJson.item) return [];

  return postmanJson.item.map((item, index) => {
    const req = item.request || {};
    const urlObj = req.url || {};
    const headers = req.header || [];

    // ===== URL =====
    const rawUrl = urlObj.raw || "";
    const path = urlObj.path?.join("/") || "";

    // ===== BODY =====
    let bodyFields = [];
    let bodyRaw = null;

    if (req.body?.mode === "raw") {
      bodyRaw = req.body.raw;
      try {
        bodyFields = Object.keys(JSON.parse(bodyRaw));
      } catch {}
    }

// ===== AUTH =====
let hasAuthHeader = false;
let authType = null;

// 1. Header Authorization (raw)
const authHeader = headers.find(
  h => h.key?.toLowerCase() === "authorization"
);

if (authHeader) {
  hasAuthHeader = true;
  authType = authHeader.value?.startsWith("Bearer")
    ? "Bearer"
    : "Custom";
}

// 2. Postman auth object (QUAN TRỌNG)
if (req.auth?.type) {
  hasAuthHeader = true;
  authType = req.auth.type; // bearer, basic, oauth2, etc
}


    // ===== METHOD TYPE =====
    const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const isReadMethod = req.method === "GET";

    // ===== FILE UPLOAD =====
    const isFileUpload =
      bodyFields.some(f => f.toLowerCase().includes("file")) ||
      rawUrl.toLowerCase().includes("upload");

    // ===== USER INPUT =====
    const hasUserInput =
      bodyFields.length > 0 ||
      rawUrl.includes("?");

    return {
      index: index + 1,
      name: item.name,
      method: req.method,
      url: rawUrl,
      path,

      // ==== security signals ====
      bodyFields,
      hasBody: bodyFields.length > 0,
      hasUserInput,
      hasAuthHeader,
      authType,
      isWriteMethod,
      isReadMethod,
      isFileUpload
    };
  });
}

module.exports = { analyzePostman };

