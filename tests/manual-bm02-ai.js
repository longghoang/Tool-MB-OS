// Optional smoke test against the configured AI. Uses synthetic data only.
const assert = require('node:assert/strict');
const scope = require('../services/scopeReview.service');
const service = require('../services/bm02Review.service');
(async () => {
  const html = '<h1>BM01 - Phiếu Yêu cầu 20561</h1><p>Hệ thống public internet: ☐ YES ☑ NO</p><p>Hệ thống phát triển có ảnh hưởng tới các tính năng ngoài internet: ☐ YES ☑ NO</p><p>Có giao dịch tài chính: ☑ YES ☐ NO</p><p>Hệ thống phát triển trên nền tảng: ☐ Mobile ☑ Web ☑ API ☐ Khác</p><h2>Scope API kiểm thử</h2><p>POST /v1/orders</p><p>GET /v1/orders/{id}</p>';
  const bm01 = { id: 'BM01', kind: 'bm01', ...scope.documentContent(html, 'BM01') };
  const result = await service.extractBm01(bm01, '20561', async (message, percent) => console.log(percent, message));
  assert.deepEqual(result.fields, { publicInternet: 'no', internetImpact: 'no', financialTransactions: 'yes', mobile: 'no', web: 'yes', api: 'yes', other: 'no' });
  assert.equal(result.apis.length, 2); assert.equal(result.unparsed, 0);
  console.log('AI BM01 extraction: PASS (7 fields, 2 APIs).');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
