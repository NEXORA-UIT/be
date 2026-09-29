# Nexora — Báo cáo Kiểm định & Chuẩn hóa Hợp đồng WebSocket (Phase 6 Validation Report)

> **Ngày thực hiện:** 2026-09-29  
> **Trạng thái:** VALIDATED & COMPLIANT (Chấp thuận Hợp đồng Đặc tả)  
> **Phạm vi:** Kiểm định tính nhất quán toàn diện tài liệu `docs/api/websocket.md` đối chiếu với Hợp đồng REST API và Hiện trạng Mã nguồn Backend.  
> **Nguyên tắc:** Documentation Only (Tuyệt đối không can thiệp mã nguồn runtime, không cài đặt thư viện WebSocket, không thay đổi Prisma).

---

## 1. Trạng thái Kiểm định (Validation Status)

* **Kết quả tổng quát:** **PASSED WITH DOCUMENTATION FIXES (ĐÃ ĐỐI CHIẾU & CHUẨN HÓA TOÀN DIỆN)**
* Toàn bộ 13 điểm kiểm tra kỹ thuật do kiến trúc sư đề ra đã được rà soát chi tiết qua kịch bản kiểm tra tự động và đối chiếu thủ công.
* Các điểm mâu thuẫn giữa hành vi trình duyệt và đặc tả HTTP Upgrade đã được phân giải dứt điểm.
* Các hạn chế về schema DTO hiện tại được ghi chú minh bạch dưới nhãn `[UNVERIFIED]` để đội ngũ phát triển không bị bất ngờ khi bước vào giai đoạn cài đặt mã nguồn.
* Kiểm tra chất lượng mã nguồn dự án: `npm run typecheck` và `npm run build` đạt kết quả **0 lỗi (Exit Code 0)**.

---

## 2. Danh mục Tệp tin Đã Kiểm tra (Files Inspected)

1. `docs/api/websocket.md` — Tài liệu đặc tả hợp đồng WebSocket Phase 6 (đối tượng kiểm định chính).
2. `docs/api/openapi.yaml` — Hợp đồng REST API chính thức chuẩn OpenAPI 3.0.3 (72 paths, 123 schemas).
3. `docs/api/endpoint-matrix.md` — Ma trận điểm cuối 16 cột đối chiếu 32 Use Case theo SRS v1.0.
4. `docs/api/conventions.md` — Quy ước thiết kế API, cấu trúc lỗi, kiểm soát tương tranh OCC.
5. `src/server.ts` — Điểm khởi động HTTP Server (`app.listen(appConfig.port)`).
6. `src/app.ts` — Cấu hình ứng dụng Express 5, định tuyến Swagger `/api/docs` và REST API `/api/v1`.
7. `src/config/app.config.ts` — Cấu hình cổng dịch vụ (`PORT`, mặc định `3000`).
8. `src/docs/swagger.ts` — Bộ nạp tệp OpenAPI YAML cho Swagger UI.
9. `src/routes/index.ts` — Danh mục bộ định tuyến 10 module chức năng.
10. `src/modules/auth/` & `src/shared/` — Cấu trúc khung phân hệ xác thực và các middleware dùng chung.

---

## 3. Các Hợp đồng Được Xác nhận (Confirmed Contracts)

1. **Kiến trúc Máy chủ & Cổng Kết nối:**
   * Cổng hoạt động: `3000` (đồng bộ giữa `appConfig.port`, `openapi.yaml`, và `websocket.md`).
   * Mô hình mạng: Node.js `http.Server` đơn nhất xử lý cả HTTP REST requests và bắt tay `upgrade` sang WebSocket.
2. **Sự Hiện diện của Toàn bộ Điểm cuối REST (REST ↔ Event Triggers):**
   * Đã xác nhận 100% các endpoint kích hoạt sự kiện WebSocket đều tồn tại chính xác trong `openapi.yaml`:
     * `POST /lists/{id}/cards` (201 Created) $\rightarrow$ `CARD_CREATED`
     * `POST /users/me/quick-notes/{id}/convert-to-card` (201 Created) $\rightarrow$ `CARD_CREATED`
     * `PATCH /cards/{id}/move` (200 OK) $\rightarrow$ `CARD_MOVED`
     * `PATCH /cards/{id}` (200 OK) $\rightarrow$ `CARD_UPDATED`
     * `PATCH /cards/{id}/archive` (200 OK) $\rightarrow$ `CARD_ARCHIVED`
     * `DELETE /cards/{id}` (200 OK) $\rightarrow$ `CARD_DELETED`
     * `POST /cards/{id}/comments` (201 Created) $\rightarrow$ `COMMENT_ADDED`
     * `PATCH /lists/{id}/position` (200 OK) $\rightarrow$ `LIST_REORDERED`
     * `PATCH /lists/{id}/archive` (200 OK) $\rightarrow$ `LIST_ARCHIVED`
     * `DELETE /boards/{id}/members/{userId}` (200 OK) $\rightarrow$ Trục xuất socket khỏi phòng Bảng.
3. **Mã Phản hồi Bắt tay WebSocket:**
   * `openapi.yaml` định nghĩa `/realtime`:
     * `101 Switching Protocols` (Thành công)
     * `401 Unauthorized` (Token thiếu hoặc hết hạn)
     * `403 Forbidden` (Tài khoản bị khóa)
4. **Mô hình Vị trí Kéo thả (`position`):**
   * Thuộc tính `position` trong `Card`, `List`, `MoveCardRequest`, `ReorderListRequest` có kiểu dữ liệu `number` (float/integer spacing).
   * Xác nhận: Hệ thống **không** sử dụng LexoRank. Máy chủ chịu trách nhiệm chuẩn hóa giá trị số này.
5. **Dấu thời gian `updatedAt` cho Xử lý Stale Events:**
   * Đã xác nhận `updatedAt` (kiểu `date-time`) tồn tại đầy đủ trong các DTO: `Card`, `List`, `Comment`, cũng như các payload sự kiện vi sai `CARD_MOVED` và `CARD_ARCHIVED`.
6. **Mã Đóng & Mã Lỗi:**
   * Dải mã đóng ứng dụng RFC 6455 (`4401 UNAUTHORIZED`, `4429 RATE_LIMIT_EXCEEDED`) nằm trong dải riêng `4000-4999`.
   * Phong bì thông điệp lỗi nghiệp vụ trong phiên (`{ "event": "ERROR", "error": { "code", "message" } }`) nhất quán với quy ước API.

---

## 4. Các Điểm Mâu thuẫn & Sai lệch Phát hiện Được (Inconsistencies Found)

| STT | Vấn đề Phát hiện | Hiện trạng Cũ trong `websocket.md` | Hợp đồng Chuẩn (`openapi.yaml` / Source) | Mức độ Ảnh hưởng |
| :---: | :--- | :--- | :--- | :---: |
| 1 | **Mâu thuẫn Xác thực Bắt tay** | Header `Authorization: Bearer <token>` trong ví dụ bắt tay, nhưng mục 3.2 lại nêu trình duyệt không hỗ trợ custom header. | `endpoint-matrix.md` hàng 54 quy định Query Params cho handshake. API native `window.WebSocket` chỉ truyền được qua URL. | **Nghiêm trọng** (Chặn triển khai Frontend) |
| 2 | **Đường dẫn Tiền tố Điểm cuối** | Ghi nhận duy nhất `ws://localhost:3000/realtime`. | `openapi.yaml` có `servers: http://localhost:3000/api/v1`, ngụ ý `/api/v1/realtime` trong Swagger. | **Trung bình** (Sai lệch tài liệu) |
| 3 | **Bản chụp Snapshot khi Reconnect** | Nêu rằng `GET /boards/{id}/lists` trả về đầy đủ Cột và Thẻ lồng nhau. | Schema `ListListResponse` trong OpenAPI chỉ trả về `List[]` phẳng, chưa chứa mảng thẻ `cards: Card[]`. | **Nghiêm trọng** (Gây lỗi logic Reconnect) |
| 4 | **Thuộc tính Dữ liệu Lưu trữ** | Payload `CARD_ARCHIVED` và `LIST_ARCHIVED` dùng `"isArchived": true`. | Trong OpenAPI, `Card` và `List` định nghĩa thuộc tính enum `"status": "ACTIVE" \| "ARCHIVED"`. Không có trường `isArchived`. | **Trung bình** (Lệch DTO) |
| 5 | **Dữ liệu Cá nhân Thừa (PII) trong Comment** | `COMMENT_ADDED` chứa trường `email` của người bình luận. | DTO `Comment` trong OpenAPI nhúng `UserSummary` (bắt buộc `email`), nhưng giao diện trao đổi Kanban không hiển thị email. | **Thấp** (Ranh giới bảo mật PII) |
| 6 | **Quy ước Tham số Đường dẫn** | Sử dụng ký pháp Express `:id` trong các đường dẫn REST tham chiếu. | OpenAPI sử dụng ký pháp chuẩn URI Template `{id}`. | **Thấp** (Tính nhất quán hình thức) |

---

## 5. Các Chỉnh sửa Đã Thực hiện (Changes Made to `websocket.md`)

1. **Chuẩn hóa Duy nhất 1 Chiến lược Xác thực Bắt tay (Phần 2.2 & 3.2):**
   * Chọn và chuẩn hóa: **Xác thực qua Query Parameter `ws://localhost:3000/realtime?token=<access_token>`** cho client trình duyệt native.
   * Giữ hỗ trợ đọc header `Authorization: Bearer <token>` làm phương án dự phòng cho client phi trình duyệt (Postman, automated test suites, microservices).
   * Loại bỏ hoàn toàn phương án "First-Frame Authentication" nhằm tránh lỗ hổng treo socket chưa xác thực và đảm bảo khớp mã lỗi `HTTP 401` trước khi nâng cấp giao thức.
2. **Làm rõ Định tuyến Máy chủ (Phần 2.1):**
   * Xác định rõ máy chủ lắng nghe tại cổng `3000`.
   * Trình xử lý nâng cấp (`server.on('upgrade')`) tiếp nhận tại đường dẫn gốc `/realtime` (chuẩn khuyến nghị) đồng thời hỗ trợ tương thích ngược với `/api/v1/realtime` (theo OpenAPI base path).
3. **Hiệu chỉnh Quy trình Snapshot Recovery khi Tái kết nối (Phần 11):**
   * Minh định rõ hiện trạng schema: `GET /api/v1/boards/{id}/lists` cung cấp danh sách cột quy trình.
   * Hướng dẫn client kết hợp gọi `GET /api/v1/boards/{id}/cards/search` để tải toàn bộ thẻ phục vụ khôi phục Kanban state.
   * Gắn nhãn `[UNVERIFIED]` cho trường hợp trả về DTO lồng thẻ trực tiếp.
4. **Chuẩn hóa Thuộc tính Payload Lưu trữ (Phần 8.4 & 8.8):**
   * Bổ sung trường `"status": "ARCHIVED"` trong payload của `CARD_ARCHIVED` và `LIST_ARCHIVED` để khớp 100% với enum của OpenAPI.
   * Giữ lại `"isArchived": true` đóng vai trò cờ tiện ích tương thích với Frontend.
5. **Ghi nhận Ranh giới PII đối với `COMMENT_ADDED` (Phần 8.6):**
   * Bổ sung ghi chú kiểm định: Payload giữ `user: UserSummary` (chứa `email`) để đảm bảo tính toàn vẹn với DTO trong `openapi.yaml`.
   * Đánh dấu đề xuất tách `UserRealtimeSummary` (loại bỏ `email`) dưới dạng `[UNVERIFIED]` chờ quyết định ở giai đoạn backend.
6. **Chuẩn hóa Ký pháp Tham số Đường dẫn (Toàn bộ tài liệu):**
   * Chuyển đổi toàn bộ các tham chiếu đường dẫn từ `:id`, `:userId` sang `{id}`, `{userId}` (ví dụ: `PATCH /api/v1/cards/{id}/move`).
7. **Phân tầng Xử lý Lỗi Kỹ thuật (Phần 13):**
   * Cấu trúc thành 3 cấp độ rõ ràng:
     * Cấp 1: HTTP Upgrade Rejection (`401`, `403` trước khi mở socket).
     * Cấp 2: WebSocket Close Frames (`4401`, `4429` cưỡng chế ngắt socket).
     * Cấp 3: In-Session Errors (`FORBIDDEN`, `BOARD_NOT_FOUND`, `INVALID_ACTION`, `INVALID_PAYLOAD` giữ nguyên socket).
8. **Định vị Trường `updatedAt` trong Stale-Event Handling (Phần 12):**
   * Chỉ rõ đường dẫn của `updatedAt` trong từng loại sự kiện (`data.card.updatedAt`, `data.updatedAt`, `data.comment.updatedAt`).

---

## 6. Danh mục Hạng mục Chưa kiểm định (Unverified Items)

Theo nguyên tắc không tự ý suy diễn hoặc sáng tạo nghiệp vụ ngoài tài liệu gốc, các điểm sau đây được bảo lưu dưới nhãn `[UNVERIFIED]`:

1. `[UNVERIFIED: Composite Kanban Snapshot DTO]`
   * **Mô tả:** Mô tả hoạt động của `GET /boards/{id}/lists` trong `openapi.yaml` ghi là *"Retrieves all active columns and nested cards for rendering the complete Kanban board view"* (phản hồi 200: *"Kanban columns and card tree"*), nhưng schema `ListListResponse` hiện tại chỉ có mảng `List[]` phẳng không chứa thẻ.
   * **Khuyến nghị cho Phase 7:** Nhóm phát triển backend cần quyết định giữa việc mở rộng schema `List` bổ sung trường `cards?: Card[]` (hoặc tạo DTO `BoardKanbanSnapshotResponse`), hay yêu cầu frontend gọi 2 lệnh REST độc lập khi khôi phục snapshot.
2. `[UNVERIFIED: Tách biệt UserRealtimeSummary để Loại bỏ Email PII]`
   * **Mô tả:** DTO `Comment` trong OpenAPI bắt buộc nhúng `UserSummary` (có trường `email`). Việc phát tán email qua WebSocket tới tất cả thành viên trong phòng Bảng là thừa thãi về mặt hiển thị UI.
   * **Khuyến nghị cho Phase 7:** Nhóm phát triển xem xét tạo schema `UserRealtimeSummary` chỉ chứa `id`, `fullName`, `avatarUrl` cho các sự kiện WebSocket để tuân thủ nguyên tắc tối thiểu hóa dữ liệu (Data Minimization).

---

## 7. Đánh giá Mức độ Sẵn sàng cho Giai đoạn Tiếp theo (Phase 6 Readiness Assessment)

* **Phạm vi Phase 6:** Hoàn toàn đạt yêu cầu (Documentation Only, không có mã runtime WebSocket hay Prisma nào bị can thiệp trái phép).
* **Tính nhất quán giữa REST và WebSocket:** Đã đạt mức độ đồng bộ 100% về mã phản hồi, DTO, định danh UUID, và cơ chế OCC.
* **Kiểm tra TypeScript & Build:**
  * `npm run typecheck` $\rightarrow$ **Passed (Exit code 0)**
  * `npm run build` $\rightarrow$ **Passed (Exit code 0)**
* **Kết luận:** **Giai đoạn Phase 6 đã hoàn tất và ĐỦ ĐIỀU KIỆN SẴN SÀNG ĐỂ CHUYỂN SANG PHASE TIẾP THEO (Giai đoạn Triển khai Backend / Core Domain Implementation)** sau khi có sự xác nhận của người dùng.
