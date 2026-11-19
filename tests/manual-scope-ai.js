// Live integration check; sends synthetic data only. Run explicitly with node.
const assert = require('node:assert/strict');
const { documentContent, analyze } = require('../services/scopeReview.service');

async function main() {
  const sources = [
    { id: 'BM01', kind: 'bm01', ...documentContent('<h1>BM01 - PYC DEMO-001 - hệ thống CMV</h1><p>Toàn bộ phạm vi API pentest UAT: chỉ POST /v1/orders thuộc OrderService, tạo đơn hàng mới.</p><p>Hệ thống public internet: NO</p><p>Hệ thống phát triển có ảnh hưởng tới các tính năng ngoài internet: YES</p><p>Kính gửi: Phòng Vận hành</p><p>☑ Pentest Hạ tầng; ☑ Pentest Ứng dụng</p><p>Dịch vụ triển khai trên môi trường: ☐ LIVE; þ PILOT; ☐ UAT</p><p>Họ và tên: Vũ Đinh Trường An. Email: anvdt1@mbbank.com.vn</p><p>Mô tả chức năng mới của hệ thống: Tạo đơn hàng mới.</p>', 'BM01') },
    { id: 'DOC1', kind: 'document', pyc: 'DEMO-001', ...documentContent('<h1>PYC DEMO-001 - Phát triển trong đợt Go-live này</h1><p>OrderService: POST /v1/orders tạo mới đơn hàng cho người dùng đã đăng nhập.</p><p>OrderService: PATCH /v1/orders/{id}/cancel là API phát triển mới trong cùng PYC và đợt UAT; cho phép chủ đơn hủy đơn đang ở trạng thái PENDING. Cần pentest API này trước Go-live.</p>', 'DOC1') }
  ];
  const result = await analyze(sources, message => console.log(message));
  assert.ok(result.matrix.some(row => row.path.includes('/cancel') && row.status === 'Nghi vấn thiếu scope'));
  assert.ok(result.findings.some(finding => finding.type === 'missing_scope' && finding.evidenceValid));
  assert.ok(result.businessAnalysis.length > 50);
  for (const code of ['internetConsistency','cmvInternet','recipient','infrastructure','pilot']) assert.equal(result.bm01Checks.find(c => c.code === code).status, 'alert', code);
  assert.equal(result.bm01Checks.find(c => c.code === 'live').status, 'pass');
  assert.equal(result.bm01Checks.find(c => c.code === 'authorEmail').status, 'pass');
  assert.equal(result.testFocus, undefined);
  console.log(JSON.stringify({ ok: true, model: result.model, findings: result.findings.map(f => ({ title: f.title, type: f.type, evidenceValid: f.evidenceValid })), matrixRows: result.matrix.length }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
