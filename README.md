# TNS Live Studio

Ứng dụng mã nguồn mở để lưu bình luận Facebook livestream và điều hành mini game. Một máy chủ local, một cổng `3210`, nhiều thiết bị trong LAN, SQLite trên máy của bạn. Giao diện tiếng Việt. Giấy phép MIT.

## Chạy nhanh

Khuyến nghị Node.js 24 LTS. Bản đầu cũng được kiểm thử với Node 20.16; nên dùng Node LTS còn được hỗ trợ khi vận hành lâu dài.

```sh
npm ci
npm run build
npm start
```

Mở **http://localhost:3210**. Terminal in mã thiết lập để tạo admin đầu tiên. Không có tài khoản/mật khẩu mặc định. Mã đổi mỗi lần khởi động nếu chưa thiết lập. Giữ mã riêng cho người quản lý máy chủ.

Trong Tổng quan, chọn **Khám phá với dữ liệu demo** để thử comment, mốc bắt đầu/kết thúc, đếm người và lịch sử. Demo là dữ liệu tĩnh, được đánh dấu rõ; không phải Facebook live.

## Mạng LAN và tài khoản

Mặc định server lắng nghe `0.0.0.0:3210`. Thiết bị khác mở `http://<IP-máy-chủ>:3210`, ví dụ `http://192.168.1.50:3210`. Frontend, API và SSE cùng cổng. Cấp phép firewall cho Node/cổng này; không cần mở cổng router ra Internet.

Admin tạo tài khoản trong **Cài đặt → Thành viên**:

| Vai trò  | Quyền                                                       |
| -------- | ----------------------------------------------------------- |
| Admin    | Toàn bộ, gồm extension, AI key, tài khoản và backup         |
| Operator | Ghép nối extension, ghi livestream, tạo demo, tính gameshow |
| Viewer   | Đọc comment, lịch sử và xuất kết quả                        |

Mọi tài khoản dùng chung một không gian/dataset. Đây chưa phải hệ thống nhiều doanh nghiệp độc lập. Extension chạy cùng máy với server; các thiết bị LAN dùng dashboard chung. Admin/operator tạo mã ghép nối tại Thêm livestream.

Danh sách ở Tổng quan hiển thị toàn bộ livestream. Admin/operator có thể xóa một livestream tại cuối mỗi dòng; thao tác này xóa vĩnh viễn bình luận, kết quả gameshow, mã ghép nối và credential extension liên kết với livestream đó.

IP của interface máy chủ được cho phép tự động. Với hostname riêng, thêm vào `ALLOWED_HOSTS` trong `.env`, phân cách bằng dấu phẩy, không có protocol/cổng. Đổi IP thì restart app. Đặt `HOST=127.0.0.1` nếu chỉ muốn dùng trên máy chủ.

Đóng tab livestream sẽ dừng ghi. Máy sleep, tắt app, tab điều hướng hoặc vùng comment đổi làm gián đoạn. Không thể khôi phục comment chưa được trình duyệt tải.

### HTTPS

HTTP không mã hóa mật khẩu, key nhập form và nội dung qua LAN. Chỉ dùng trên mạng tin cậy. Với Wi-Fi dùng chung, cung cấp certificate được các client tin cậy rồi đặt **cả** `TLS_CERT_FILE` và `TLS_KEY_FILE` trong `.env`. Restart và mở `https://...:3210`; cookie chuyển sang Secure. Không đưa app lên Internet trực tiếp.

## Docker

```sh
docker compose up --build -d
docker compose logs studio
```

Lấy mã thiết lập từ logs. Với LAN, đặt `ALLOWED_HOSTS=192.168.1.50` (thay bằng IP host thật) trong `.env` trước khi chạy Compose: IP máy host không phải interface trong container.

Dữ liệu ở named volume `studio-data`. `docker compose down` giữ dữ liệu; không thêm `-v` trừ khi chủ động muốn xóa volume. Docker build/runtime dùng Node 24 và runtime chạy user không có quyền root. Compose mặc định HTTP; khi bật TLS cần mount certificate, truyền biến TLS và cập nhật healthcheck tương ứng.

## Ghi comment bằng Chrome extension (MVP thử nghiệm)

Không cần Meta App ID/Secret hay callback Facebook OAuth. Không tự động thay đổi hoặc xóa Meta App đã tạo trước đây.

1. Chạy server native bằng các bước Chạy nhanh ở trên.
2. Trên **cùng máy chạy server**, mở Chrome → `chrome://extensions` → bật Developer mode → **Load unpacked** → chọn thư mục `extension/` của source này. Đây là bản mã nguồn mở chưa phát hành trên Chrome Web Store.
3. Trong Studio, chọn **Thêm livestream**, nhập link video và tên phiên (tùy chọn), bấm **Lấy mã livestream** (admin/operator). Dán mã vào extension mở từ biểu tượng TNS trên thanh công cụ Chrome, không mở file `popup.html`. Sau khi server chấp nhận, popup báo **Ghép nối thành công**, tên phiên và video đã kết nối. Ghép nối không tự bắt đầu thu thập.

   **Mỗi livestream có đúng một mã hiện tại, dùng lại được và không tự hết hạn.** Bấm **Xem mã** hoặc nhập lại cùng link trả về mã cũ, kể cả sau khi server khởi động lại. **Đổi mã** vô hiệu mã cũ và toàn bộ kết nối của riêng phiên đó, giữ nguyên comment. **Thu hồi thiết bị** chỉ ngắt thiết bị; người còn giữ mã có thể ghép nối lại, nên đổi mã nếu cần chặn việc đó. Ghép nối lại từ cùng extension sử dụng credential cũ để cập nhật thiết bị. Chuyển sang video khác cần mã của video đó; server và extension đều kiểm tra ràng buộc này.

   **Một video Facebook = một lịch sử comment.** Dừng rồi ghi lại cùng video sẽ tiếp tục lịch sử đó; video khác được lưu riêng. Các lượt ghi có mã phiên riêng để từ chối dữ liệu đến muộn từ lượt trước. Đây không phải chức năng chia mỗi lượt ghi thành một lịch sử độc lập; vòng gameshow dùng mốc Bắt Đầu/Kết Thúc.

   Khi cập nhật extension: dừng ghi và gửi hết hàng chờ trước, tải lại TNS tại trang Extensions của Chrome rồi tải lại tab Facebook và Studio. Phiên bản extension hiện tại: **0.4.2**. Popup luôn hiện livestream đang ghép nối; Studio dùng heartbeat nền để phân biệt thiết bị đang kết nối và ngoại tuyến. Dán lại đúng mã của phiên đang ghi chỉ xác nhận trạng thái, không thay credential hoặc làm mất hàng chờ. Kết nối cũ chưa gắn video cần ghép nối bằng mã của phiên; lịch sử comment được giữ nguyên.

4. Đăng nhập Facebook trực tiếp trong trình duyệt. Mở video riêng qua `/videos/ID` hoặc `watch?v=ID`. Không dùng news feed hoặc link `/share/…`.
5. Ngay trên tab đó, bấm extension, xác nhận quyền thu thập, chọn **Chọn tab này & vùng comment**. Bấm một comment mẫu; kiểm tra vùng viền tím và mẫu tên/nội dung. Nếu mẫu bị sai hoặc chứa bài viết khác, không bắt đầu. Chọn lại vùng hoặc báo lỗi giao diện.
6. Bấm **Xác nhận vùng & bắt đầu**. Tùy chọn ghi cả comment đã tải được bật mặc định; các comment này mang thời gian quan sát, **không phải thời gian đăng**. Phiên tự xuất hiện trong Studio qua SSE.
7. Giữ tab, Chrome và server hoạt động. Mở vùng comment mới nhất/tất cả bằng thao tác của bạn nếu giao diện có. Extension không tự bấm tải thêm, mở replies, cuộn trang hay gọi API nội bộ Facebook.
8. Dừng từ popup extension. Trong Studio có thể tạm dừng nhận; tiếp tục phải chọn lại từ extension. Xem và lọc dữ liệu đã lưu trên mọi thiết bị LAN.

### Phạm vi và bảo mật

- Chỉ xin `activeTab`, `scripting`, `storage` và quyền kết nối loopback; không có quyền cookies, không theo dõi mọi tab, không tự inject trên Facebook, không có `externally_connectable`.
- Content script chạy isolated world, chỉ đọc DOM hiển thị trong vùng người dùng duyệt. Không lấy mật khẩu, token Facebook, request nội bộ hoặc trạng thái ẩn của trang.
- Mã phiên là secret 256-bit, được mã hóa trong SQLite bằng master.key để xem lại; hash dùng để kiểm tra ghép nối. Chỉ tài khoản quản lý mã hoặc admin được xem/đổi. Không gửi mã cho người không có quyền ghi; mã không chứng minh quyền quản lý Facebook. Mã bị xóa khi restore backup nhằm tránh khôi phục quyền truy cập cũ.
- Popup/worker ghép nối server; credential thiết bị chỉ lưu trong Chrome storage dành cho trusted contexts, không đưa vào trang Facebook/content script. Server lưu hash, ràng buộc extension ID, tài khoản cấp quyền và livestream, hết hạn 7 ngày. Credential hết hạn có thể ghép nối lại bằng cùng mã phiên; mã không tự đổi.
- Chỉ bridge POST /pair, /status, /start, /batch, /stop cho phép capability auth. Dashboard vẫn dùng session + CSRF + kiểm tra Host/Origin. Bridge chỉ nhận IP loopback và host localhost/127.0.0.1; **không nhận trực tiếp từ máy LAN**.
- Bản extension này hỗ trợ backend native HTTP loopback. HTTPS LAN vẫn là tùy chọn của dashboard nhưng extension hiện chưa hỗ trợ endpoint TLS. Docker bridge có thể xuất hiện bằng IP gateway nên chưa được hỗ trợ cho capture; dùng native để ghi, không nới bảo vệ loopback.
- Nếu Chrome yêu cầu quyền truy cập mạng local, người dùng tự xem và cấp đúng quyền cho extension. Chưa có cam kết tương thích mọi phiên bản Chrome/chính sách doanh nghiệp.

### Độ đầy đủ và hàng chờ

- Parser dùng `role=article`, link profile, permalink comment và các khối văn bản hiển thị. Facebook có thể đổi DOM; preview mẫu phải đúng trước khi xác nhận. Không có mẫu hợp lệ thì không ghi.
- Dedup theo comment ID khi DOM có permalink. Nếu thiếu, dùng ID quan sát trên từng node; re-render/reload có thể tạo trùng. UI/CSV gắn nhãn rõ. Không ghép người theo tên.
- Worker giữ tối đa 300 comment chưa gửi trong storage, gửi mỗi batch tối đa 20. Bấm **Gửi lại dữ liệu đang chờ** để retry; gửi lại cùng ID không thêm bản trùng. Hàng chờ không bị xóa tự động khi upload lỗi.
- Hàng chờ cũ quá 24 giờ, server restart, thu hồi hoặc dừng phiên có thể không gửi tiếp được. **Xuất hàng chờ ra JSON** trước khi chọn **Bỏ hàng chờ / kết thúc phiên lỗi**, rồi ghép nối/bắt đầu lại. JSON là bản cứu dữ liệu, chưa có UI nhập lại tự động.
- Tab có buffer ngắn trước khi worker xác nhận. Đóng/reload tab trong lúc chưa giao xong có thể mất phần đó. Không quảng bá thu đủ 100%.
- Không đồng bộ sự kiện sửa/xóa/ẩn. Chỉ văn bản; không ảnh/sticker/voice. Replies không có cấu trúc nhận diện có thể bị coi như root. Link profile là dấu hiệu danh tính, không phải Facebook ID đã xác thực. Không tự xác minh Page/profile có thuộc quyền quản lý người dùng.
- Sau 30 giây không có heartbeat, Studio báo mất kết nối và yêu cầu bắt đầu lại. Video không được xác nhận đang LIVE: trạng thái chỉ là **đang quan sát tab**.

### Quyền sử dụng dữ liệu

Chỉ dùng khi có quyền thu thập phù hợp; sở hữu Page/đăng nhập Facebook không tự động là sự cho phép thu thập tự động của Meta. [Meta nói rõ về thu thập tự động](https://about.fb.com/news/2021/04/how-we-combat-scraping/amp/). Mã nguồn không vượt cơ chế chặn, CAPTCHA, quyền truy cập hay giới hạn nền tảng.

Luồng Graph API cũ còn trong source để bảo toàn lịch sử/khả năng bảo trì, nhưng đã bỏ khỏi giao diện và collector mặc định bị tắt. Không cần cấu hình các biến FACEBOOK_*.

## AI dùng key riêng

Trong **Cài đặt → Nhà cung cấp AI**, chọn:

- OpenAI, gợi ý `gpt-5.4-nano`.
- Gemini, gợi ý `gemini-3.1-flash-lite`.
- OpenAI-compatible: Base URL, model và key nếu cần. Endpoint cần Chat Completions + `response_format.json_schema`. Endpoint từ xa phải HTTPS; HTTP chỉ cho loopback của máy chủ.

Key chỉ ở RAM mặc định, cần nhập lại sau restart. Tùy chọn **Ghi nhớ** mã hóa AES-256-GCM vào DB. `data/master.key` nằm trên cùng máy chủ: người có cả DB và master.key vẫn giải mã được. Đây không phải OS Keychain. Key/token/Meta secret không được trả về API đọc cấu hình hoặc lưu ở localStorage. Đổi provider/Base URL không tự chuyển key cũ sang nhà cung cấp khác.

AI nhận câu hỏi và tối đa 80 comment mốc/chủ live gần nhất (ID, tên, nội dung, thời gian), không nhận toàn bộ comment. UI hiển thị thông báo trước khi gửi. OpenAI đặt `store:false`; chính sách dữ liệu khác phụ thuộc provider/tài khoản. Bộ lọc trả về được kiểm tra schema và người dùng kiểm tra trước khi tính.

AI không có quyền chạy SQL/code, đọc file hoặc sửa DB. MVP chỉ hỗ trợ exact/contains, hai mốc, đếm người/comment, bỏ chủ live và tính reply đã thu. Lọc ngữ nghĩa, regex, chọn người thắng chưa hỗ trợ. Thu thập/lọc thủ công không cần key.

Tài liệu model: [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4-nano), [Gemini](https://ai.google.dev/gemini-api/docs/pricing). Model và giá thay đổi; cần kiểm thử luật tiếng Việt thực tế.

## Luật gameshow

- Hai mốc cùng livestream, cùng ID tác giả xác định được, bắt đầu trước kết thúc. Bỏ cả hai để tính toàn phiên.
- Nguồn browser: khoảng mở theo thứ tự DB nhận (`start.seq < comment.seq < end.seq`), không phải thứ tự gửi thật. Nguồn demo/Graph cũ vẫn dùng timestamp và báo ties. Các comment đã tải sẵn được đọc theo thứ tự DOM, có thể khác thứ tự thời gian.
- Chuẩn hóa NFKC, trim, chữ thường. Đúng bằng `5` không tính `15` hoặc `em chọn 5`.
- Đếm người theo ID nguồn/link profile chuẩn hóa, không theo tên. Thiếu danh tính báo riêng. Nguồn browser mặc định không bỏ host; nếu chọn bỏ, cần hai mốc cùng tác giả và app loại chính tác giả mốc đó.
- Mỗi lần tính lưu snapshot comment và kết quả. Dữ liệu đến muộn/sửa nội dung không sửa kết quả cũ; chạy lại tạo bản mới.
- Kết quả browser luôn tạm tính kể cả khi dừng. Các nguồn khác đang thu thập thì kết quả tạm tính. “Đã lưu” chỉ xác nhận snapshot lưu thành công, không xác nhận Facebook trả đủ dữ liệu.

## Backup / restore

`data/studio.sqlite` lưu comment, tài khoản (password hash scrypt), phiên đăng nhập, nguồn, cấu hình và kết quả. `data/master.key` giải mã secret đã lưu. Không commit thư mục data. SQLite dùng WAL, không copy riêng file DB khi app đang chạy.

**Cài đặt → Máy chủ & dữ liệu → Tải backup** dùng SQLite Online Backup. File gồm dữ liệu riêng, password hash, session và các secret đã mã hóa; chỉ admin tải được. Bảo quản file như dữ liệu riêng tư của team.

Khôi phục native:

```sh
# Dừng app trước bằng Ctrl+C
npm run restore -- /duong-dan/tns-backup.sqlite
npm start
```

Restore kiểm tra integrity/schema, giữ bản dữ liệu cũ trong thư mục `data/restore-before-*`, thay DB, xóa phiên đăng nhập, ghép nối extension và kết nối Facebook/AI khỏi bản khôi phục, tắt collector. Đăng nhập lại, ghép nối extension/cấu hình AI rồi chủ động thu thập. Comment, tài khoản và kết quả được giữ. File khóa ngăn hai instance cùng chạy hoặc restore đè khi server còn chạy; không xóa file khóa khi chưa xác nhận tiến trình đã dừng.

Với Docker, dừng container và khôi phục trong source checkout, sau đó chuyển DB đã khôi phục vào named volume khi container còn dừng. CLI restore không nằm trong runtime image tối giản. Giữ bản sao volume cũ trước khi thay đổi.

## Phát triển / kiểm thử

```sh
npm run check
npm test
npm run build
npm run dev
```

`dev` theo dõi backend và phục vụ frontend đã build; sửa frontend thì build lại. Không có cổng Vite thứ hai. Tests dùng DB tạm và phản hồi Facebook/AI giả lập, không phát sinh phí API. CI cấu hình Node 22/24.

Source: `src/` React, `extension/` Chrome MV3, `server/` API/auth/capture/DB/AI, `shared/` types/schema, `tests/`. Backend kiểm tra role, CSRF, Origin/Host; session HttpOnly/SameSite. Chỉ expose LAN tin cậy và cập nhật thư viện định kỳ.

**Trạng thái MVP:** backend/local/demo và helper parser có kiểm thử tự động; chưa xác minh extension end-to-end trên DOM Facebook thật. Cần pilot đối chiếu comment hiển thị với DB trước khi dùng. AI thật vẫn cần key để xác minh. Không có SLA hoặc cam kết thu đủ dữ liệu cho gameshow có giải thưởng.
