// services/aiChecklist.service.js
const fs = require("fs");
const path = require("path");

// load checklist
const apiChecklist = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/api.json")));
const featureChecklist = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/feature.json")));
const globalChecklist = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/global.json")));

function autoChecklist(apis) {
  // clone checklist
  const checkedApi = apiChecklist.map(item => ({
    ...item,
    needTest: false
  }));

  const checkedFeature = featureChecklist.map(item => ({
    ...item,
    needTest: false
  }));

  const checkedGlobal = globalChecklist.map(item => ({
    ...item,
    needTest: false
  }));

  for (const api of apis) {
    const method = (api.method || "").toUpperCase();
    const body = api.bodyFields || [];
    const url = (api.url || "").toLowerCase();

    const hasInput = body.length > 0;
    const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

    /* =========================
       AUTH / SESSION
    ========================= */
    if (body.includes("userName") || body.includes("userPass")) {
      checkedApi.forEach(item => {
        if (item.code?.startsWith("OTG-SESS")) item.needTest = true;
      });
      checkedFeature.forEach(item => {
        if (item.code?.startsWith("OTG-AUTHN")) item.needTest = true;
      });
    }

    /* =========================
       INPUT VALIDATION / SQLi
    ========================= */
    if (hasInput || isWriteMethod) {
      checkedApi.forEach(item => {
        // SQL Injection – ALWAYS test if has input
        if (
          item.task?.toLowerCase().includes("sql injection") ||
          item.code?.startsWith("OTG-INPVAL")
        ) {
          item.needTest = true;
        }
      });
    }

    /* =========================
       PARAMETER TAMPERING / HPP
    ========================= */
    if (hasInput) {
      checkedApi.forEach(item => {
        if (item.task?.toLowerCase().includes("parameter")) {
          item.needTest = true;
        }
      });
    }

    /* =========================
       FILE UPLOAD
    ========================= */
    if (url.includes("upload")) {
      checkedFeature.forEach(item => {
        if (item.code?.startsWith("OTG-BUSLOGIC")) {
          item.needTest = true;
        }
      });
    }
  }

  return {
    api: checkedApi,
    feature: checkedFeature,
    global: checkedGlobal
  };
}

module.exports = { autoChecklist };
