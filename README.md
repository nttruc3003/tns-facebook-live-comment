# TNS Live Studio

Ứng dụng mã nguồn mở để lưu bình luận Facebook livestream và điều hành mini game. Một máy chủ local, một cổng `3210`, nhiều thiết bị trong LAN, SQLite trên máy của bạn. Giao diện tiếng Việt. Giấy phép MIT.

## Chạy nhanh

Khuyến nghị Node.js 24 LTS. Bản đầu cũng được kiểm thử với Node 20.16; nên dùng Node LTS còn được hỗ trợ khi vận hành lâu dài.

### Chạy lần đầu

```sh
cd /Users/franknguyen/teamnailsupplyllc/tns-facebook-live-comment
cp .env.example .env
npm ci
npm run build
npm start
```

Mở **http://localhost:3210**. Terminal in mã thiết lập để tạo admin đầu tiên. Không có tài khoản/mật khẩu mặc định. Mã đổi mỗi lần khởi động nếu chưa thiết lập. Giữ mã riêng cho người quản lý máy chủ.

### Những lần chạy sau

```sh
cd /Users/franknguyen/teamnailsupplyllc/tns-facebook-live-comment
npm start
```

### Chế độ phát triển

```sh
npm run build
npm run dev
```

Lệnh `dev` theo dõi thay đổi của backend và phục vụ frontend đã build. Sau khi sửa frontend, chạy lại `npm run build`.

Trong Tổng quan, chọn **Khám phá với dữ liệu demo** để thử comment, mốc bắt đầu/kết thúc, đếm người và lịch sử. Demo là dữ liệu tĩnh, được đánh dấu rõ; không phải Facebook live.

## Mạng LAN và tài khoản

Mặc định server lắng nghe `0.0.0.0:3210`. Thiết bị khác mở `http://<IP-máy-chủ>:3210`, ví dụ `http://192.168.1.50:3210`. Frontend, API và SSE cùng cổng. Cấp phép firewall cho Node/cổng này; không cần mở cổng router ra Internet.

Admin tạo tài khoản trong **Cài đặt → Thành viên**:

| Vai trò  | Quyền                                                       |
| -------- | ----------------------------------------------------------- |
| Admin    | Toàn bộ, gồm extension, AI key, tài khoản và backup         |
| Operator | Chọn nguồn Collect, ghi livestream, tạo demo, tính gameshow |
| Viewer   | Đọc comment, lịch sử và xuất kết quả                        |

Mọi tài khoản dùng chung một không gian/dataset. Đây chưa phải hệ thống nhiều doanh nghiệp độc lập. Extension chạy cùng máy với server; các thiết bị LAN dùng dashboard chung. Admin/operator chọn nguồn Collect tại Thêm livestream.

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

## Collect comment bằng Chrome extension

Extension **0.5.0** thu comment độc lập với server. Không cần nhập mã livestream.

1. Cài thư mục `extension/` bằng **Load unpacked** trong Chrome trên cùng máy chạy Studio.
2. Mở video Facebook riêng qua `/videos/ID` hoặc `watch?v=ID`, mở extension và bấm **Collect**.
3. Extension tự bắt đầu khi tìm thấy một vùng comment rõ ràng, có permalink khớp video. Nếu không xác định chắc chắn, bấm vào một comment mẫu và chọn **Collect vùng đã chọn**. Bảng điều khiển nằm ở **bên trái** trang Facebook.
4. Comment được lưu vào hàng chờ IndexedDB trên máy ngay cả khi server chưa chạy. Đóng popup không dừng thu. Giữ tab Facebook mở.
5. Mở **http://localhost:3210 → Thêm livestream**, chọn nguồn đang Collect rồi bấm **Chọn & lưu** (admin/operator). Hàng chờ cũ được gửi theo thứ tự trước comment mới. Nếu video đã có lịch sử, dữ liệu tiếp tục được lưu vào lịch sử đó.
6. **Dừng thu** trong extension ngừng đọc tab nhưng giữ hàng chờ và tiếp tục đồng bộ nếu nguồn đã được chọn. **Ngừng lưu** trên website chỉ ngừng ghi database; extension vẫn thu vào hàng chờ.

Popup có một nút **Collect / Dừng thu**, số comment đang chờ và đã đồng bộ. Mục **Hàng chờ & thiết bị** cho phép đặt tên Chrome để phân biệt profile, đồng bộ lại hoặc xuất JSON. Số đã đồng bộ là số bản ghi server đã xác nhận xử lý, có thể gồm comment trùng đã tồn tại trong lịch sử.

### Kết nối và hàng chờ

- Extension tự giới thiệu từng lượt thu với server qua HTTP loopback; chỉ gửi thông tin video, trạng thái và số lượng trước khi bạn chọn lưu. Server chỉ nhận nội dung comment khi admin/operator đã duyệt nguồn trên website.
- Mỗi cài đặt Chrome có định danh bí mật riêng lưu trong trusted extension storage; không đưa định danh vào trang Facebook hoặc file xuất hàng chờ. Cùng extension ID trên các profile vẫn là các thiết bị khác nhau.
- Mỗi lượt Collect có hàng chờ riêng theo video. Bản đầu hỗ trợ một tab đang Collect trên mỗi cài đặt extension. Dừng lượt hiện tại để đổi tab; hàng chờ các lượt cũ vẫn được giữ.
- Một video dùng chung một lịch sử và chỉ một nguồn được chọn lưu tại một thời điểm. Ngừng lưu nguồn cũ trước khi chọn nguồn khác. Comment có ID Facebook được chống trùng trong cùng video; comment không có permalink có thể trùng khi đọc lại hoặc qua thiết bị khác.
- Hàng chờ chỉ được xóa sau xác nhận của server. Gửi lại sau lỗi phản hồi không thêm bản trùng của cùng bản ghi. Server restart giữ liên kết đã chọn; restore backup yêu cầu chọn lại nguồn.
- Hàng chờ giới hạn khoảng **100 MB nội dung comment** trên mỗi cài đặt, cảnh báo khi đạt 80%. Hết dung lượng thì dừng nhận thêm và báo rõ; không âm thầm bỏ comment cũ. Không tự xóa hàng chờ theo tuổi; dữ liệu quá 24 giờ vẫn có thể đồng bộ.
- Tab giữ một buffer nhỏ trước khi extension xác nhận đã lưu bền vững. Đóng/reload tab đột ngột vẫn có thể mất phần chưa giao xong. Đóng Chrome dừng thu nhưng giữ phần đã lưu IndexedDB; mở lại tab và bấm Collect để thu mới. Gỡ extension hoặc xóa dữ liệu trình duyệt có thể làm mất hàng chờ, nên xuất JSON khi cần cứu dữ liệu.
- Nguồn không liên lạc trong 75 giây được hiển thị ngoại tuyến. Đồng bộ được thử lại khi có comment/heartbeat hoặc khi bạn mở popup. Không khẳng định video đang phát LIVE: trạng thái chỉ phản ánh việc quan sát tab.
- Trong lúc còn hàng chờ, website hiển thị **Đang đồng bộ**. Kết quả gameshow còn tạm tính; thứ tự là thứ tự quan sát trong từng lượt thu, không phải thời gian đăng thật trên Facebook.

### Cập nhật từ extension cũ

Dừng ghi trước khi cập nhật, tải lại extension trong Chrome rồi tải lại tab Facebook. Hàng chờ cũ được chuyển sang IndexedDB trong lần khởi động worker mới, giữ nguyên video và nội dung. Chọn lại nguồn trên website để cho phép lưu. Backend vẫn giữ API ghép nối cũ để tương thích; giao diện mới dùng Collect và chọn nguồn. Không chuyển đổi hoặc xóa lịch sử comment đã lưu.

### Phạm vi

Extension chỉ đọc DOM hiển thị; không lấy cookie/token Facebook, gọi API nội bộ, tự cuộn hoặc mở comment ẩn. Không đảm bảo thu đủ 100%, không đồng bộ sửa/xóa/ẩn comment, chỉ thu văn bản. Facebook thay đổi giao diện có thể làm parser không đọc được hoặc cần chọn vùng thủ công.

Extension vẫn kết nối **server native HTTP trên cùng máy, cổng 3210**. Các thiết bị LAN dùng website chung để xem và chọn nguồn; thu từ extension trên máy khác, HTTPS bridge và Docker bridge chưa được hỗ trợ. Dashboard giữ đăng nhập, phân quyền, CSRF và kiểm tra Host/Origin. Nguồn được phát hiện tự động không tự có quyền ghi database.

### Quyền sử dụng dữ liệu

Chỉ dùng khi có quyền thu thập phù hợp; sở hữu Page/đăng nhập Facebook không tự động là sự cho phép thu thập tự động của Meta. [Meta nói rõ về thu thập tự động](https://about.fb.com/news/2021/04/how-we-combat-scraping/amp/). Mã nguồn không vượt cơ chế chặn, CAPTCHA, quyền truy cập hay giới hạn nền tảng.

Luồng Graph API cũ còn trong source để bảo toàn lịch sử/khả năng bảo trì, nhưng đã bỏ khỏi giao diện và collector mặc định bị tắt. Không cần cấu hình các biến FACEBOOK_*.

## AI autofill số trong comment

Trong livestream → **Filter comments**, chọn mốc bắt đầu/kết thúc và lọc cột nếu cần, rồi bấm **AI autofill**. Chọn 10 hoặc 20 comment mỗi nhóm (mặc định 20). Danh sách được chốt lúc bấm; từng nhóm gửi ID/nội dung comment đến nhà cung cấp đã lưu (OpenAI hoặc Claude) từ máy chủ, kết quả tự hiện trong bảng và tự lưu. Cần admin cấu hình provider **OpenAI** hoặc **Anthropic / Claude**, model hỗ trợ Structured Outputs và API key ở Cài đặt.

Bảng và CSV có 3 cột từ **1st number** đến **3rd number**. AI lấy tối đa 3 số nguyên viết bằng chữ số theo thứ tự xuất hiện, giữ số 0 đầu: `em chọn 05 và 27` chỉ điền `05`, `27`; cột còn lại để trống. Các comment chỉ gồm danh sách như `5v6`, `5 và 6`, `3,4` được hiểu là các số riêng; dấu phẩy trong dạng này là dấu phân cách, không phải dấu thập phân. Không có số thì để trống. Nội dung mơ hồ như giá tiền, số điện thoại, số âm/thập phân được yêu cầu để trống và đánh dấu kiểm tra; hơn 3 số lấy 3 số đầu và đánh dấu. AI có thể sai: vẫn cho sửa cả 3 cột và bấm **Save** để lưu phần sửa tay.

Nếu AI trả số sai định dạng, không có nguyên dạng hoặc sai thứ tự trong comment, phần mềm bỏ toàn bộ số AI của riêng comment đó và ghi cảnh báo để kiểm tra; các comment hợp lệ trong nhóm vẫn được lưu. Response sai cấu trúc hoặc thiếu/trùng/sai ID vẫn dừng nhóm để tránh gán nhầm kết quả.

AI chỉ điền ô trống, giữ số đã có và các ô đang sửa. Comment bị sửa hoặc được lưu số thủ công trong lúc chờ AI sẽ được bỏ qua. **Dừng** hoàn tất nhóm đang chạy rồi dừng; **Tiếp tục** chạy phần chưa hoàn tất của danh sách ban đầu. Lỗi ở một nhóm giữ nguyên kết quả các nhóm trước; lỗi 429/5xx được thử lại tối đa hai lần. Rời livestream dừng gửi nhóm tiếp theo, nhưng nhóm đang gửi vẫn có thể hoàn tất và lưu.

Nút **AI điền dòng còn trống (N)** chỉ gửi N comment đang lọc có cả ba ô số trống, tính cả sửa tay chưa lưu. Dòng có một hoặc hai số không bị gửi lại. Comment đã xử lý nhưng vẫn không có số có thể được gửi lại bằng nút này. Nút **AI autofill** vẫn xử lý toàn bộ vùng lọc.

Nút **Xóa số trong vùng lọc (N)** xóa ba cột số và cảnh báo AI của đúng N comment đang khớp khoảng mốc và các bộ lọc cột, bao gồm phần sửa tay chưa lưu. Nội dung comment và lịch sử gọi AI giữ nguyên. Nút tạm khóa khi AI đang chạy hoặc đang lưu; xóa xong có thể bấm AI autofill để thử lại. Các số ngoài vùng lọc không đổi.

### Lịch sử gọi AI autofill

Bấm **Lịch sử gọi AI** cạnh AI autofill để xem các chunk mới nhất, mở log cũ hơn hoặc tải chi tiết thành JSON. Mỗi log ghi thời gian, provider/model, request body (gồm prompt và comment), toàn bộ response body của từng lần thử, HTTP status, request ID nếu có, lỗi và kết quả sau xử lý/giá trị đã lưu. Phản hồi gốc được tách riêng khỏi số sau khi phần mềm áp dụng quy tắc như `5v6` → `5`, `6`. Không ghi header xác thực/API key; chuỗi key nhận diện được hoặc key hiện tại bị che nếu xuất hiện trong nội dung. Admin/operator có quyền xem, viewer không có quyền. Log nằm trong database trên máy chủ, đi cùng backup; xóa livestream sẽ xóa log của livestream đó. Khi ứng dụng khởi động lại, các log chưa hoàn tất được đánh dấu gián đoạn. Chức năng chỉ ghi AI autofill từ khi được cài đặt; không khôi phục được request/response của lần chạy cũ.

## AI dùng key riêng

Trong **Cài đặt → Nhà cung cấp AI**, chọn:

- OpenAI, gợi ý `gpt-5.4-nano`.
- Anthropic / Claude: chọn Claude Haiku 4.5, Sonnet 5.5 hoặc Opus 5.5; gọi trực tiếp Anthropic Messages API.
- Gemini, gợi ý `gemini-3.1-flash-lite`.
- OpenAI-compatible: Base URL, model và key nếu cần. Endpoint cần Chat Completions + `response_format.json_schema`. Endpoint từ xa phải HTTPS; HTTP chỉ cho loopback của máy chủ.

Menu **Model** có các lựa chọn theo nhà cung cấp và **Model khác — nhập tên** cho model ID tùy chỉnh. Danh sách là preset, không xác nhận quyền truy cập của tài khoản. Chọn provider, chọn model, nhập API key tương ứng rồi bấm **Lưu cấu hình AI**. Claude dùng cùng cấu hình cho AI autofill và trợ lý tạo bộ lọc.

Key chỉ ở RAM mặc định, cần nhập lại sau restart. Tùy chọn **Ghi nhớ** mã hóa AES-256-GCM vào DB. `data/master.key` nằm trên cùng máy chủ: người có cả DB và master.key vẫn giải mã được. Đây không phải OS Keychain. Key/token/Meta secret không được trả về API đọc cấu hình hoặc lưu ở localStorage. Đổi provider/Base URL không tự chuyển key cũ sang nhà cung cấp khác.

Chức năng AI tạo bộ lọc nhận câu hỏi và tối đa 80 comment mốc/chủ live gần nhất (ID, tên, nội dung, thời gian), không nhận toàn bộ comment. UI hiển thị thông báo trước khi gửi. OpenAI đặt `store:false`; chính sách dữ liệu khác phụ thuộc provider/tài khoản. Bộ lọc trả về được kiểm tra schema và người dùng kiểm tra trước khi tính.

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

Restore kiểm tra integrity/schema, giữ bản dữ liệu cũ trong thư mục `data/restore-before-*`, thay DB, xóa phiên đăng nhập, ghép nối extension và kết nối Facebook/AI khỏi bản khôi phục, tắt collector. Đăng nhập lại, chọn lại nguồn Collect/cấu hình AI rồi chủ động thu thập. Comment, tài khoản và kết quả được giữ. File khóa ngăn hai instance cùng chạy hoặc restore đè khi server còn chạy; không xóa file khóa khi chưa xác nhận tiến trình đã dừng.

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
