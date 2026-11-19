# BM01 Scope Review

Mở `/scope-review` hoặc chọn **BM01 Scope Review** từ `/home` sau khi khởi động lại server.

1. Upload BM01 `.docx` (tối đa 10 MB).
2. Nhập mỗi dòng `số Phiếu Yêu cầu - ID` hoặc `số Phiếu Yêu cầu - URL`, ví dụ `20608 - 895978834`, `20608-895978834` hoặc `20602-https://confluence.mbbank.com.vn/display/ORS/ms109-api-f88-preapp-limit`; khoảng trắng quanh dấu phân cách là tùy chọn. Tối đa 10 dòng. Với URL, tool ghép nguyên chuỗi thành `pageId=20602-https://...` rồi gửi qua endpoint export hiện có.
3. Có thể tải thêm tối đa 10 file tài liệu tham chiếu `.docx` hoặc `.pdf` (mỗi file tối đa 10 MB). File được đọc tại server và đưa vào cùng phiên phân tích; PDF scan không có lớp văn bản sẽ cần OCR ở bước khác.
4. Tool gửi GET `http://10.63.150.20:5000/jc/export?pageId=<request-number-ID-or-URL>&format=html`, sử dụng cookie ở `config/scope-review.js`. Không theo redirect đăng nhập; trang yêu cầu phê duyệt bị đánh dấu lỗi kể cả khi trả HTTP 200. HTML được làm sạch và hiển thị trong iframe sandbox.
5. Kiểm tra nguồn rồi bấm phân tích. Kết quả gồm ba phần: luồng hoạt động/logic thay đổi; scope API và mô tả chức năng mới so với tài liệu; alert kiểm tra BM01. Không sinh đề xuất sửa BM01 hay checklist pentest chung.
   Khi BM01 có bảng **Danh sách API / Web Service** rõ ràng, tool đọc trực tiếp method/path và bằng chứng từng dòng thay vì yêu cầu AI lặp lại cả bảng. AI vẫn phân tích luồng nghiệp vụ, logic thay đổi và đối chiếu scope với tài liệu; API trích xuất trực tiếp vẫn được giữ đầy đủ trong kết quả.
6. Sau khi phân tích hoàn tất, chatbot ở cạnh kết quả cho phép hỏi thêm về đúng BM01, tài liệu và kết quả của phiên. Lịch sử chat được lưu cùng phiên đánh giá; câu hỏi tối đa 4.000 ký tự.
7. Xuất hồ sơ JSON hoặc in/lưu PDF bằng trình duyệt.

## Note BM02

- Đọc BM01 trong phiên hiện tại, nhập số Phiếu Yêu cầu ở mục Note BM02 rồi chọn **Chuẩn bị Note BM02**. Tool gọi `/api/task/getOwnList` với trạng thái `processing`, chỉ tiếp tục khi tìm được đúng một task khớp số phiếu và lấy `task_id`.
- Tool POST `/jc/` với số phiếu để đọc tên hệ thống, sau đó POST `/api/assets/get-folder-tree` trên CSD để tìm đúng một `service_name` khớp và điền `service_id` vào `services`. Tên và ID được hiển thị để pentester kiểm tra trước khi lưu; không có hoặc có nhiều kết quả khớp sẽ báo lỗi.
- Các trường Internet, giao dịch tài chính, nền tảng và `server_api` được lấy từ BM01. Khi các ô chọn và bảng API đọc được rõ ràng, tool trích xuất trực tiếp để không phải gửi danh sách API dài cho AI; dữ liệu chưa rõ vẫn được đánh dấu chưa xác định. API được chuyển thành URL không kèm method, giữ nguyên `http://` hoặc `https://` nếu BM01 ghi rõ; path chưa có host dùng `https://{base-url}`. Các giá trị tự điền được hiển thị để pentester rà soát. Checklist chuẩn được đính kèm khi lưu.
- Với mỗi bug, nhập mô tả, mức độ và mã test case tùy chọn (để trống dùng `N/A`). AI soạn tên lỗi, mô tả, PoC theo bước và khuyến nghị 3–4 dòng. Trường vị trí ảnh hưởng để trống. Chế độ Phiếu No Bug lưu bản nháp không có lỗ hổng.
- Chỉ khi bấm **Lưu nháp Note BM02 lên CSD**, tool mới POST `/api/draft/addMultiple`. Nội dung được lưu dưới dạng nháp, tool không nộp báo cáo.

## Check BM02

- Chọn BM01 ở phần nạp hồ sơ, nhập **Số Phiếu Yêu cầu**, bấm **Check BM02**. Không cần nhập tài liệu Confluence cho luồng này. Nếu BM01 đã được đọc trong phiên hiện tại, kiểm tra sử dụng lại BM01 và giữ nguyên kết quả phân tích, alert, lịch sử chat. Chọn file BM01 mới tạo phiên mới để tránh ghép nhầm hồ sơ.
- Server POST `/jc/` với form `pyc`, đọc tên hệ thống và trạng thái từ HTML. Trạng thái khác `In Progress` (không phân biệt hoa thường/khoảng trắng) báo đỏ ngay khi đọc được.
- Server đọc thông báo `/api/notification/get-list`. ID thông báo **không phải** ID bản nháp trên CSD hiện tại (ID mẫu trả HTTP 400). Giống giao diện CSD, tool tìm đúng số phiếu trong `/api/task/getOwnList` với `{ "status": "processing" }`, lấy `full_draft_id` rồi POST `/api/draft/getMyListById/{id}`. Không tự chọn khi có nhiều task cùng số phiếu. Nếu chưa có task, thử ID thông báo theo yêu cầu tích hợp ban đầu, tối đa 20 trang/4.000 thông báo và 12 ID; không tìm được sẽ báo lỗi rõ ràng.
- BM01 được AI trích riêng theo từng phần, kiểm tra trích dẫn tồn tại, rồi code so sánh checklist, số lượng API, hai khai báo Internet, giao dịch tài chính và bốn nền tảng Mobile/Web/API/Khác. Không yêu cầu số Phiếu Yêu cầu xuất hiện trong BM01. Mục API chỉ hiện tổng số API mỗi bên và kết luận số lượng khớp/chênh lệch, không liệt kê endpoint; số lượng bằng nhau được đánh dấu đạt khi đã đọc đầy đủ, không xác nhận từng endpoint tương ứng. Dữ liệu thiếu hoặc chưa đọc rõ báo đỏ, không tự suy ra NO.
- Chỉ khi mọi mục đạt mới hiện “Sẵn sàng để nộp theo các mục đã kiểm tra”. Không gửi/nộp báo cáo lên CSD. Tiến độ thể hiện các bước xử lý, không phải ước tính thời gian còn lại.
- Trước khi đếm, loại trùng ở cả BM01 và BM02 theo host + path, bỏ qua HTTP method: GET/POST/PUT cùng một endpoint chỉ tính một API. Giữ riêng các endpoint khác host, phiên bản hoặc chữ hoa/thường trong path. Số lượng hiển thị và kết luận đều dùng tổng sau loại trùng.
- Cookie và tài khoản nằm phía server trong `config/bm02.local.json` (đã bỏ khỏi Git), không gửi ra trình duyệt/JSON xuất. Biến môi trường ghi đè: `BM02_JC_USERNAME`, `BM02_JC_PASSWORD`, `BM02_CSD_USERNAME`, `BM02_CSD_PASSWORD`, `BM02_CSD_COOKIE`. Cookie JC ban đầu dùng cấu hình scope review hiện có. Tự đăng nhập và thử lại một lần khi nhận trang login/401/403; phiên mới được giữ trong bộ nhớ server. HTTPS CSD vẫn xác minh chứng chỉ.

## Kết nối AI / 9router

Dùng endpoint tương thích Chat Completions trả JSON. Cần URL đầy đủ, tên model đúng trong router và API key của router nếu endpoint yêu cầu. Không dùng cookie ChatGPT làm API key. Ví dụ PowerShell (thay giá trị minh họa bằng cấu hình thực tế):

Cấu hình riêng của máy có thể lưu trong `config/scope-review.local.json` với các trường `aiUrl`, `aiModel`, `aiKey`. File này đã được loại khỏi Git. Biến môi trường ưu tiên hơn file local. Với base URL kết thúc bằng `/v1`, URL đầy đủ sẽ thêm `/chat/completions`.

```powershell
$env:SCOPE_AI_URL = 'http://127.0.0.1:PORT/v1/chat/completions'
$env:SCOPE_AI_MODEL = 'TEN_MODEL_TRONG_ROUTER'
$env:SCOPE_AI_KEY = 'API_KEY_CUA_ROUTER'
npm start
```

Không giả định cổng/model 9router. Biến môi trường được đọc khi server khởi động. Có thể thay cookie mặc định qua `SCOPE_CONFLUENCE_COOKIE` (toàn bộ `session=...`). Cookie và key chỉ nằm phía server, không được đưa vào hồ sơ xuất. Nội dung văn bản BM01/tài liệu sẽ được gửi đến endpoint AI đã cấu hình khi bấm phân tích.

## Phạm vi và giới hạn

- Checklist BM01: địa chỉ ứng dụng; tài liệu đặc tả; tài khoản ứng dụng; mô hình 6.1; các cơ chế kết nối 6.2; version framework; người lập phiếu/email; kính gửi Phòng Đảm bảo An toàn thông tin – TT ATTT – Khối CNTT; hai trường Internet phải YES–YES hoặc NO–NO; CMV với Public Internet NO; checkbox Pentest Hạ tầng, LIVE và PILOT.
- AI trích xuất trường và bằng chứng; code áp dụng quy tắc Internet/CMV/checkbox. Trường không đọc rõ hoặc mâu thuẫn được đưa vào nhóm cần xác nhận, không tự kết luận đạt. Các mục đạt thu gọn.
- DOCX: giữ dấu checkbox Wingdings, checkbox content control và legacy; đếm đối tượng ảnh/sơ đồ nằm trong mục 6.1. Sự hiện diện đối tượng không xác minh được nội dung sơ đồ. Phiên đã upload trước thay đổi này cần upload lại để đọc cấu trúc DOCX.
- Họ tên/email chỉ kiểm tra tính phù hợp của cách viết tắt. Chưa kết nối danh bạ nên không xác thực danh tính; ví dụ Vũ Đinh Trường An / anvdt1@mbbank.com.vn được coi là phù hợp.

- Chưa đọc ảnh/sơ đồ/OCR hoặc tải file đính kèm/trang con. Hiển thị cảnh báo, không tự kết luận scope đầy đủ.
- Tối đa 300.000 ký tự mỗi nguồn. Đọc theo phần khoảng 16.000 ký tự. Bước tổng hợp tối đa 150.000 ký tự dữ liệu trích xuất; vượt giới hạn sẽ báo cần chia phiên, không âm thầm cắt nguồn.
- API được phân loại thêm/sửa/bỏ/tham khảo/chưa rõ. Method/path khớp chỉ là gợi ý; khác phiên bản không tự gộp. AI có thể sai dù trích dẫn tồn tại: pentester cần kiểm chứng diễn giải.
- Chưa cấu hình AI vẫn đọc DOCX và xem HTML được; không tạo kết quả AI giả.
- Bản chụp HTML đã làm sạch, văn bản, hash nội dung gốc, thời gian lấy tài liệu, kết quả và xác nhận lưu dưới `reports/scope-reviews`. Không lưu file DOCX gốc. Bảo quản thư mục này như tài liệu nội bộ.
- Truy cập hồ sơ giới hạn theo session hiện có của ứng dụng. Ứng dụng đang dùng session trong bộ nhớ: khởi động lại server sẽ mất quyền truy cập phiên cũ; tải JSON trước khi restart. Chưa có quản lý hồ sơ xuyên phiên hay tài khoản riêng.
- Chạy `npm test` để kiểm tra parser, lấy tài liệu, bằng chứng, đối soát và HTTP flow bằng dữ liệu giả lập. Cần BM01 thực và kết nối AI thực để đánh giá chất lượng nghiệp vụ.
