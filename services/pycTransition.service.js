const axios = require("axios");
const FormData = require("form-data");

const TARGET_URL = "http://10.63.150.20:5000/jc/issue/transition";

// ⚠️ Cookie để nguyên hoặc load từ env
const COOKIE =
  "session=.eJw9j91qA0EIhV9l8ToUnb-d2QfpTROCO6PZQLqUnWyhhLx7LS29UY8fHvUBZ71xX6TD9PaA4W4J3qV3vggc4HW_DrfjjqhuvQxWENFPRG9yXY47CbePf0BS_XDf9q-h_qEXOD1PB1uySV9gMiamrg0miOPoa5tTw1ZcQq7cqLjCUrJr6lE0R9KZHErBMbFgTOgkxxJD8oEzV0rBmYlqrmKdWSliDUklSjKz0TU3V-JMKkxBbBiD-iQU3cz23nnvsv1e87nWDs9vC9VRFw.aYlhDQ.IW_HUN_d3Wp61gGG61UE7WFP2cM";

async function transitionOnePYC(pycNumber) {
  const form = new FormData();
  form.append("pyc", `PENTEST-${pycNumber}`);

  return axios.post(TARGET_URL, form, {
    headers: {
      ...form.getHeaders(),
      Cookie: COOKIE,
      Origin: "http://10.63.150.20:5000",
      Referer: "http://10.63.150.20:5000/jc/",
    },
    timeout: 10000,
  });
}

async function transitionPYCList(pycList = []) {
  const results = [];

  for (const pyc of pycList) {
    try {
      await transitionOnePYC(pyc);
      results.push({ pyc, status: "SUCCESS" });
    } catch (err) {
      results.push({
        pyc,
        status: "FAILED",
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = {
  transitionPYCList,
};
