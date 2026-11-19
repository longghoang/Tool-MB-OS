// Chỉ sử dụng ở server. Không trả cookie/API key trong response hoặc báo cáo.
const fs = require('fs');
const path = require('path');
const localPath = path.join(__dirname, 'scope-review.local.json');
const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : {};
module.exports = {
  documentUrl: 'http://10.63.150.20:5000/jc/export',
  cookie: process.env.SCOPE_CONFLUENCE_COOKIE || 'session=.eJw9j01qAzEMha8yaB2K5R_ZnoN004SgsaVMIB3KOC6UkLvXpaVaSHr64El6wFlv3FZpML89YLqPAu_SGl8EDvDar9Pt2I1Ru12m0SDiTzZuyG09dhSuH_8ApbjpvvevqfyhFzg9T4exZJe2wjyYDHWtMAPb4pESK6otBjkQE0pCjZ6TC4hM0RkrjiL5rKIjKvtYag2kHElRXM1ax7x4R1LisEo25-wDUak2G8_GSAxGffB5ybRwFbJLtknKeO_cm-y_13xupcHzGz0WUas.arNA0w.D6P5b2MqcEU2CtWJwpBXJCWG6vM',
  aiUrl: process.env.SCOPE_AI_URL || local.aiUrl || '', // URL đầy đủ của API chat completions tương thích
  aiModel: process.env.SCOPE_AI_MODEL || local.aiModel || '',
  aiKey: process.env.SCOPE_AI_KEY || local.aiKey || ''
};
