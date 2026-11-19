const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'bm02.local.json');
const local = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
module.exports = {
  jcBase: 'http://10.63.150.20:5000', csdBase: 'https://csd.mbbank.com.vn',
  jcUsername: process.env.BM02_JC_USERNAME || local.jcUsername || '',
  jcPassword: process.env.BM02_JC_PASSWORD || local.jcPassword || '',
  pycCookie: process.env.PYC_JC_COOKIE || local.pycCookie || '',
  csdUsername: process.env.BM02_CSD_USERNAME || local.csdUsername || '',
  csdPassword: process.env.BM02_CSD_PASSWORD || local.csdPassword || '',
  csdCookie: process.env.BM02_CSD_COOKIE || local.csdCookie || ''
};
