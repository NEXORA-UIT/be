# Nexora — Đặc tả Kỹ thuật Hợp đồng WebSocket Realtime (Phase 6)
## Phân hệ Đồng bộ Thời gian thực & Cộng tác Bảng Kanban

> **Phiên bản tài liệu:** 1.2.0 (Strict Consistency Validated)  
> **Trạng thái:** Formal Specification (Documentation Only)  
> **Kênh phạm vi:** Cấp độ Bảng dự án (`board:{boardId}`)  
> **Tài liệu tham chiếu:** `docs/api/openapi/`, `docs/api/endpoint-matrix.md`, `docs/api/conventions.md`, SRS v1.0 (Mục 3.1.3, 3.5, 6.1.2)
> **Use Case trọng tâm:** `UC-COL-15`, `UC-COL-16`, `UC-COL-17`, `UC-Card-12`, `UC-List-10`

---

## 1. Tổng quan Kiến trúc & Nguyên tắc Vận hành (Overview)

### 1.1. Mục đích Hiện diện của WebSocket trong Nexora
Nexora là nền tảng quản lý dự án thông minh đa người dùng. Khi nhiều thành viên trong cùng một Bảng (Board) làm việc đồng thời, các hành động như **kéo thả thẻ việc giữa các cột, tạo thẻ mới, chỉnh sửa thông tin, lưu trữ/xóa thẻ, hoặc thêm bình luận** cần được phản ánh ngay lập tức trên màn hình của tất cả các thành viên đang hoạt động nhằm tránh xung đột thao tác và tăng cường trải nghiệm cộng tác.

### 1.2. Nguyên tắc Bất biến: REST là Nguồn Thẩm quyền Thay đổi Dữ liệu (Authoritative State)
Hệ thống Nexora phân định ranh giới kiến trúc tuyệt đối giữa hai giao thức:

```text
Frontend (Client A)
   │
   │ (1) Gửi lệnh REST API (POST, PATCH, DELETE)
   ▼
REST API Server
   │
   ├─► (2a) Xác thực JWT & Phân quyền RBAC
   ├─► (2b) Kiểm tra Quy tắc nghiệp vụ (Business Rules)
   ├─► (2c) Kiểm tra Tương tranh Lạc quan (OCC qua updatedAt)
   └─► (2d) Thực thi Transaction vào PostgreSQL
   │
   ▼ (3) Giao dịch hoàn tất thành công (Transaction Committed)
   │
   ├─► Phản hồi HTTP 200/201 cho Client A
   │
   ▼ (4) Kích hoạt Phát sóng Sự kiện Thời gian thực (Pub/Sub)
WebSocket Server
   │
   ▼ (5) Broadcast sự kiện tới phòng board:{boardId}
Other Connected Clients (Client B, Client C, ...)
```

1. **REST API — Nguồn Thẩm quyền Duy nhất (Authoritative State Mutation):**
   * Mọi thao tác làm biến đổi trạng thái dữ liệu bền vững (Create, Update, Move, Archive, Delete, Comment, Reorder List) **bắt buộc phải đi qua REST API**.
   * REST API đảm nhận toàn bộ trách nhiệm kiểm tra bảo mật RBAC, thẩm định tính hợp lệ của dữ liệu, kiểm tra xung đột tương tranh lạc quan (OCC) và thực thi lưu trữ bền vững vào cơ sở dữ liệu PostgreSQL.
2. **WebSocket — Kênh Lan truyền Sự kiện Thời gian thực (Server-to-Client Event Distribution):**
   * WebSocket **tuyệt đối KHÔNG** đóng vai trò kênh tiếp nhận lệnh thay đổi dữ liệu thay thế cho REST.
   * Client **không gửi** các lệnh đột biến như `CARD_MOVED`, `CARD_CREATED`, `CARD_UPDATED` qua WebSocket.
   * WebSocket là kênh một chiều (Server-to-Client) dùng để phát sóng thông báo đồng bộ sau khi giao dịch REST đã lưu trữ thành công vào cơ sở dữ liệu.
3. **Phạm vi Lan truyền (Board-Level Isolation Scope):**
   * Các sự kiện Kanban chỉ phát sóng trong phạm vi phòng Bảng cụ thể (`board:{boardId}`). Thành viên đang ở Bảng A tuyệt đối không bao giờ nhận được sự kiện phát sinh từ Bảng B.
4. **Mục tiêu Hiệu năng (Latency Target — NFR-02):**
   * Mục tiêu thời gian lan truyền sự kiện đồng bộ từ khi máy chủ xác nhận giao dịch REST thành công đến khi các client khác nhận được qua WebSocket là **dưới 500ms** (Căn cứ: SRS Mục 6.1.2, yêu cầu phi chức năng `NFR-02`, tiêu chuẩn `[SRS-CORE]`). Đây là mục tiêu hiệu năng thiết kế, không tạo thành cam kết SLA cứng ngoài phạm vi hệ thống.

---

## 2. Điểm Kết nối & Nâng cấp Giao thức (Connection & Protocol)

### 2.1. Endpoint Kết nối & Cấu hình Cổng Máy chủ
* **Cấu hình Cổng:** Máy chủ backend vận hành trên cổng cấu hình `appConfig.port` (`PORT` từ môi trường, mặc định `3000`).
* **Đường dẫn Bắt tay:**
  * Kênh WebSocket được định tuyến tại đường dẫn: `/realtime`
  * Trong hợp đồng `OpenAPI contract`, do tiền tố máy chủ là `http://localhost:3000/api/v1`, điểm cuối được tài liệu hóa là `/realtime` (được ánh xạ thành `/api/v1/realtime` trong Swagger UI).
  * Về mặt kiến trúc máy chủ HTTP Express (`http.Server`), trình xử lý sự kiện nâng cấp (`server.on('upgrade')`) tiếp nhận tại:
    - Đường dẫn gốc chuẩn: `ws://localhost:3000/realtime` (khuyến nghị cho Client)
    - Đồng thời hỗ trợ tương thích ngược: `ws://localhost:3000/api/v1/realtime`
* **Môi trường Phát triển Cục bộ (Development):**
  ```text
  ws://localhost:3000/realtime?token=<access_token>
  ```
* **Môi trường Sản xuất Thực tế (Production):**
  ```text
  wss://api.nexora.local/realtime?token=<access_token>
  ```
  *(Môi trường sản xuất bắt buộc sử dụng giao thức bảo mật WSS qua lớp mã hóa TLS/HTTPS).*

### 2.2. Bắt tay Nâng cấp (HTTP Upgrade Handshake)
Quá trình thiết lập kết nối tuân theo chuẩn RFC 6455 thông qua HTTP 1.1 Upgrade:
* **Phương thức:** `GET`
* **Đường dẫn:** `/realtime?token=<access_token>`
* **Yêu cầu Bắt tay Thực tế từ Trình duyệt (Native Browser Handshake):**
  ```http
  GET /realtime?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... HTTP/1.1
  Host: localhost:3000
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
  Sec-WebSocket-Version: 13
  ```
* **Yêu cầu Bắt tay từ Client Phi trình duyệt (Non-browser / Service-to-Service):**
  Client phi trình duyệt (Postman, test suite tự động, backend microservices) có thể truyền token qua HTTP Header tiêu chuẩn:
  ```http
  GET /realtime HTTP/1.1
  Host: localhost:3000
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
  Sec-WebSocket-Version: 13
  Authorization: Bearer <access_token>
  ```
* **Phản hồi Thành công (`101 Switching Protocols`):**
  ```http
  HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
  ```
* **Phản hồi Thất bại Trước khi Nâng cấp (HTTP Handshake Errors):**
  Máy chủ kiểm tra token ngay trong sự kiện `upgrade`. Nếu không hợp lệ, trả về HTTP status code trực tiếp và **không** nâng cấp kết nối:
  * `401 Unauthorized`: Token xác thực bị thiếu, không hợp lệ, hoặc đã hết hạn (`TOKEN_EXPIRED`). Khớp với response `401` trong `OpenAPI contract`.
  * `403 Forbidden`: Người dùng bị khóa tài khoản hoặc bị cấm truy cập hệ thống. Khớp với response `403` trong `OpenAPI contract`.

---

## 3. Cơ chế Xác thực Danh tính (Connection Authentication)

### 3.1. Yêu cầu Xác thực Cốt lõi
* Tất cả kết nối WebSocket đều phải được xác thực danh tính người dùng bằng **JWT Access Token** hợp lệ (thời hạn 15 phút, cấp từ `POST /api/v1/auth/login` hoặc `POST /api/v1/auth/refresh`).
* Hệ thống **từ chối kết nối ẩn danh (Anonymous connection)**. Kết nối không có danh tính hợp lệ sẽ bị từ chối ngay lập tức tại bước bắt tay HTTP Upgrade (`401 Unauthorized`).

### 3.2. Chiến lược Xác thực Duy nhất Sẵn sàng Triển khai (Normative Transport Strategy)
Để giải quyết triệt để rào cản kỹ thuật của API WebSocket trên trình duyệt web (native `window.WebSocket` không hỗ trợ tùy biến HTTP Headers trong request bắt tay):

* **Chiến lược Được Chọn và Chuẩn hóa:** **Xác thực qua Query Parameter trong URL Bắt tay (`?token=<access_token>`)**.
* **Căn cứ Kỹ thuật & Bằng chứng Dự án:**
  1. `docs/api/endpoint-matrix.md` hàng 54 (`UC-COL-15`) quy định rõ: Điểm kết nối `/realtime (ws)` nhận tham số truy vấn (Query Params) để bắt tay xác thực (`WS Handshake`).
  2. Phù hợp hoàn toàn với API chuẩn của trình duyệt: `new WebSocket('ws://localhost:3000/realtime?token=' + accessToken)`.
  3. Cho phép máy chủ Node.js phân tích và kiểm tra tính hợp lệ của token một cách đồng bộ trong sự kiện `upgrade` trước khi chấp thuận nâng cấp, đảm bảo trả về đúng mã lỗi `HTTP 401 / 403` như cam kết trong `OpenAPI contract`.
  4. Loại bỏ hoàn toàn phương án "First-Frame Authentication" (vốn tạo ra trạng thái kết nối mở chưa xác thực, dễ bị khai thác DoS tài nguyên và mâu thuẫn với mã phản hồi `401` tại tầng HTTP Upgrade).
* **Cơ chế Dự phòng cho Client Phi trình duyệt:** Máy chủ hỗ trợ đọc thêm header `Authorization: Bearer <token>` nếu client có khả năng gửi custom headers. Nếu cả Query Parameter và Header đều xuất hiện, Query Parameter được ưu tiên giải mã.

---

## 4. Phân quyền Truy cập Phòng Bảng (Board Authorization & RBAC)

Xác thực danh tính (`Authentication`) là **điều kiện cần nhưng chưa đủ**. Một người dùng đăng nhập hợp lệ không tự động có quyền lắng nghe sự kiện của tất cả các Bảng trong hệ thống.

### 4.1. Ranh giới Giữa Xác thực & Phân quyền
* **Xác thực (Authentication):** Diễn ra tại thời điểm kết nối tới `/realtime`, trả lời câu hỏi: *"Bạn là ai trong hệ thống?"*.
* **Phân quyền (Authorization):** Diễn ra khi client yêu cầu tham gia phòng `board:{boardId}`, trả lời câu hỏi: *"Bạn có quyền truy cập Bảng này hay không?"*.

### 4.2. Quy tắc Phân quyền Cấp Bảng
Trước khi đưa socket vào phòng `board:{boardId}`, máy chủ WebSocket bắt buộc phải kiểm tra quyền hạn nội bộ theo mô hình RBAC đã phê duyệt:
* **Workspace Owner:** Có toàn quyền truy cập tất cả các Bảng thuộc Workspace do mình sở hữu (`UC-WS-08`).
* **Board PM (Project Manager):** Có toàn quyền quản lý và nhận sự kiện của Bảng được phân công (`UC-Board-09`).
* **Board Member:** Có quyền tham gia lắng nghe sự kiện và tương tác với các thẻ việc trong Bảng (`UC-Board-09`).
* **Người dùng ngoài Bảng (Non-member):** Bị từ chối gia nhập phòng với thông điệp lỗi `FORBIDDEN` hoặc `BOARD_NOT_FOUND`.

### 4.3. Kháng rủi ro Rò rỉ Thông tin
* Máy chủ không trả về thông tin chi tiết của Bảng khi từ chối quyền nhằm ngăn chặn tấn công dò quét mã UUID (`ID Enumeration`).

---

## 5. Cấu trúc Phòng & Kênh Truyền thông (Rooms & Channels)

Mỗi Bảng Kanban tương ứng với một phòng logic độc lập:

```text
Tên phòng: board:{boardId}
```

* **Quy ước định danh:** Sử dụng tiền tố `board:` kết hợp mã định danh UUID v4 của Bảng.
* **Ví dụ phòng hợp lệ:**
  ```text
  board:c56a4180-65aa-42ec-a945-5fd21dec0538
  ```
* **Đặc tính cách ly tuyệt đối:**
  * Mỗi thông điệp cập nhật Thẻ, Cột hoặc Bình luận chỉ được phát tán (`broadcast`) tới các kết nối đang hiện diện trong chính phòng `board:{boardId}` đó.
  * Khi người dùng đóng tab hoặc chuyển sang màn hình Bảng khác, client phải chủ động gửi thông điệp rời phòng.

---

## 6. Thông điệp Chiều Client $\rightarrow$ Server (Client-to-Server Messages)

Chiều Client $\rightarrow$ Server qua WebSocket được thiết kế **tối giản** nhằm tập trung vào việc quản lý trạng thái kết nối phòng. Mọi thao tác nghiệp vụ đều chuyển qua REST API.

### 6.1. Tham gia Phòng Bảng (`JOIN_BOARD`) `[SRS-CORE]`
Gửi yêu cầu gia nhập vào kênh sự kiện của một Bảng cụ thể sau khi kết nối WebSocket đã xác thực thành công.

* **Cấu trúc gửi đi:**
  ```json
  {
    "action": "JOIN_BOARD",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538"
  }
  ```
* **Phản hồi từ Server:**
  * **Thành công:** Nhận thông điệp xác nhận `JOINED_BOARD`:
    ```json
    {
      "event": "JOINED_BOARD",
      "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
      "occurredAt": "2026-09-29T10:30:00.000Z"
    }
    ```
  * **Thất bại:** Nhận thông điệp `ERROR` với mã `FORBIDDEN` hoặc `BOARD_NOT_FOUND`.

### 6.2. Rời khỏi Phòng Bảng (`LEAVE_BOARD`) `[SRS-CORE]`
Chủ động thông báo ngừng nhận sự kiện của Bảng (ví dụ khi người dùng điều hướng ra khỏi màn hình Board).

* **Cấu trúc gửi đi:**
  ```json
  {
    "action": "LEAVE_BOARD",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538"
  }
  ```
* **Phản hồi từ Server:**
  ```json
  {
    "event": "LEFT_BOARD",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "occurredAt": "2026-09-29T10:35:00.000Z"
  }
  ```

---

## 7. Khung Phong bì Sự kiện Chuẩn hóa (Standard Event Envelope)

Mọi sự kiện phát sóng từ máy chủ tới client đều tuân thủ cấu trúc phong bì JSON chuẩn, thống nhất với quy ước REST API của dự án:

```json
{
  "event": "TÊN_SỰ_KIỆN",
  "eventId": "UUIDv4",
  "occurredAt": "ISO_8601_UTC",
  "boardId": "UUIDv4",
  "actor": {
    "userId": "UUIDv4",
    "fullName": "Họ và tên"
  },
  "data": {}
}
```

### Chi tiết các trường trong Phong bì (Envelope Schema):
| Tên trường | Kiểu dữ liệu | Bắt buộc | Mô tả & Quy ước |
| :--- | :---: | :---: | :--- |
| `event` | `string` | **Có** | Định danh sự kiện viết hoa, phân cách bằng dấu gạch dưới (ví dụ `CARD_MOVED`). |
| `eventId` | `string (uuid)` | **Có** | Mã UUID v4 duy nhất của sự kiện, dùng để chống trùng lặp tại frontend (`Deduplication`). |
| `occurredAt` | `string (date-time)` | **Có** | Dấu thời gian máy chủ phát sinh sự kiện theo chuẩn ISO 8601 UTC (ví dụ `2026-09-29T10:15:30.000Z`). |
| `boardId` | `string (uuid)` | **Có** | Mã UUID của Bảng đích nơi phát sinh sự kiện. |
| `actor` | `object` | **Có** | Thông tin người dùng thực hiện thao tác kích hoạt sự kiện (`userId` và `fullName`). |
| `data` | `object` | **Có** | Dữ liệu chi tiết của thực thể bị thay đổi, tái sử dụng định dạng DTO từ OpenAPI. |

---

## 8. Đặc tả Chi tiết các Sự kiện Thời gian thực (Realtime Events Catalog)

### 8.1. Sự kiện Thẻ được Tạo mới (`CARD_CREATED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `POST /api/v1/lists/{id}/cards` (`UC-Card-12`)
  - Hoặc `POST /api/v1/users/me/quick-notes/{id}/convert-to-card` (`UC-PLAN-19`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thẻ đã được lưu vào PostgreSQL).
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "CARD_CREATED",
    "eventId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "occurredAt": "2026-09-29T10:15:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "card": {
        "id": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
        "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
        "listId": "7d9b23a1-4567-4e89-b123-abcdef012345",
        "title": "Thiết kế giao diện đăng nhập một chạm",
        "description": "Tích hợp nút Google và GitHub OAuth",
        "position": 65536,
        "priority": "HIGH",
        "status": "ACTIVE",
        "startDate": null,
        "dueDate": "2026-10-05T17:00:00.000Z",
        "assigneeIds": ["88e83344-99bb-44cc-88dd-112233445566"],
        "labelIds": ["33aa44bb-55cc-66dd-77ee-88ff99aa00bb"],
        "tasksCount": 0,
        "completedTasksCount": 0,
        "createdAt": "2026-09-29T10:15:00.000Z",
        "updatedAt": "2026-09-29T10:15:00.000Z"
      }
    }
  }
  ```

---

### 8.2. Sự kiện Kéo thả / Di chuyển Thẻ (`CARD_MOVED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `PATCH /api/v1/cards/{id}/move` (`UC-Card-12`, `UC-COL-15`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Vị trí và danh sách cột đích đã cập nhật trong PostgreSQL).
* **Ý nghĩa:** Cung cấp đầy đủ vị trí nguồn và đích để các máy khách cập nhật thứ tự và vẽ lại hoạt ảnh kéo thả mượt mà trên Kanban.
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "CARD_MOVED",
    "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "occurredAt": "2026-09-29T10:16:30.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "fromListId": "7d9b23a1-4567-4e89-b123-abcdef012345",
      "toListId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "oldPosition": 65536,
      "newPosition": 131072,
      "updatedAt": "2026-09-29T10:16:30.000Z"
    }
  }
  ```

---

### 8.3. Sự kiện Cập nhật Thẻ (`CARD_UPDATED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `PATCH /api/v1/cards/{id}` (`UC-Card-12`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thông tin thẻ đã cập nhật trong PostgreSQL).
* **Ý nghĩa:** Cung cấp snapshot thẻ đầy đủ để client cập nhật trực tiếp vào bộ nhớ cục bộ mà không cần gọi thêm lệnh REST.
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "CARD_UPDATED",
    "eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "occurredAt": "2026-09-29T10:18:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "card": {
        "id": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
        "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
        "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
        "title": "Thiết kế giao diện đăng nhập một chạm (Đã chỉnh sửa tiêu đề)",
        "description": "Bổ sung kiểm tra chứng chỉ SSL và rate limit",
        "priority": "URGENT",
        "position": 131072,
        "status": "ACTIVE",
        "startDate": "2026-10-01T08:00:00.000Z",
        "dueDate": "2026-10-05T17:00:00.000Z",
        "assigneeIds": ["88e83344-99bb-44cc-88dd-112233445566"],
        "labelIds": ["33aa44bb-55cc-66dd-77ee-88ff99aa00bb"],
        "tasksCount": 2,
        "completedTasksCount": 1,
        "createdAt": "2026-09-29T10:15:00.000Z",
        "updatedAt": "2026-09-29T10:18:00.000Z"
      }
    }
  }
  ```

---

### 8.4. Sự kiện Lưu trữ Thẻ việc (`CARD_ARCHIVED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `PATCH /api/v1/cards/{id}/archive` (`UC-Card-12`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thẻ chuyển trạng thái sang `status: ARCHIVED`).
* **Ý nghĩa:** Phân biệt rõ ràng với việc xóa vĩnh viễn. Thẻ được ẩn khỏi cột Kanban hiện tại nhưng vẫn tồn tại trong mục "Thẻ đã lưu trữ" và có thể khôi phục.
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "CARD_ARCHIVED",
    "eventId": "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
    "occurredAt": "2026-09-29T10:20:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "status": "ARCHIVED",
      "isArchived": true,
      "updatedAt": "2026-09-29T10:20:00.000Z"
    }
  }
  ```
  *(Ghi chú: Trường `status: "ARCHIVED"` khớp chính xác thuộc tính enum `status` trong schema `Card` của OpenAPI; trường `isArchived: true` được duy trì như cờ tiện ích cho Frontend).*

---

### 8.5. Sự kiện Xóa Vĩnh viễn Thẻ việc (`CARD_DELETED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `DELETE /api/v1/cards/{id}` (`UC-Card-12`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thẻ và các dữ liệu liên quan đã bị xóa hoàn toàn khỏi cơ sở dữ liệu).
* **Ý nghĩa:** Báo hiệu client loại bỏ hoàn toàn thẻ khỏi mọi bộ nhớ đệm và view hiển thị.
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "CARD_DELETED",
    "eventId": "5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b",
    "occurredAt": "2026-09-29T10:21:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "deletedAt": "2026-09-29T10:21:00.000Z"
    }
  }
  ```

---

### 8.6. Sự kiện Thêm Bình luận Thẻ (`COMMENT_ADDED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `POST /api/v1/cards/{id}/comments` (`UC-COL-16`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Bình luận được lưu vào PostgreSQL và hàng đợi BullMQ thông báo đã kích hoạt).
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "COMMENT_ADDED",
    "eventId": "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
    "occurredAt": "2026-09-29T10:22:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "99ff44ee-55aa-66bb-77cc-88dd99ee0011",
      "fullName": "Nguyễn Gia Bảo"
    },
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "comment": {
        "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
        "userId": "99ff44ee-55aa-66bb-77cc-88dd99ee0011",
        "content": "@datphan Vui lòng kiểm tra lại cấu hình OAuth Google trên Cloud Console.",
        "user": {
          "id": "99ff44ee-55aa-66bb-77cc-88dd99ee0011",
          "fullName": "Nguyễn Gia Bảo",
          "email": "baonguyen@university.edu.vn",
          "avatarUrl": "https://res.cloudinary.com/nexora/image/upload/avatar2.jpg"
        },
        "createdAt": "2026-09-29T10:22:00.000Z",
        "updatedAt": "2026-09-29T10:22:00.000Z"
      }
    }
  }
  ```
* **Đối chiếu Hợp đồng & Giới hạn Dữ liệu Cá nhân (PII Validation):**
  - **Khớp DTO OpenAPI:** Schema `Comment` trong `OpenAPI contract` định nghĩa trường `user` tham chiếu trực tiếp đến `UserSummary` (`required: [id, fullName, email]`). Do đó, payload hiện tại tuân thủ 100% hình thái DTO trong OpenAPI.
  - **Đánh giá Dữ liệu Thừa (PII Boundary):** Trường `email` không cần thiết cho giao diện hiển thị trao đổi thẻ Kanban (chỉ cần `fullName` và `avatarUrl`). Để tuân thủ nguyên tắc không tự ý sửa đổi OpenAPI DTO ngoài phạm vi Phase 6, payload giữ nguyên `user` theo `UserSummary`. Đề xuất tối giản hóa (loại bỏ `email` khi phát sóng realtime) được ghi nhận là:  
    `[UNVERIFIED: Cần quyết định phân tách DTO UserRealtimeSummary trong Phase triển khai backend]`.

---

### 8.7. Sự kiện Sắp xếp lại Thứ tự Cột (`LIST_REORDERED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi PM sắp xếp lại vị trí cột (`PATCH /api/v1/lists/{id}/position`) theo `UC-List-10`.
* **Phòng nhận:** `board:{boardId}`
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "LIST_REORDERED",
    "eventId": "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
    "occurredAt": "2026-09-29T10:25:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "oldPosition": 1,
      "newPosition": 2,
      "updatedAt": "2026-09-29T10:25:00.000Z"
    }
  }
  ```

---

### 8.8. Sự kiện Lưu trữ Cột Quy trình (`LIST_ARCHIVED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi PM lưu trữ một cột (`PATCH /api/v1/lists/{id}/archive`) theo `UC-List-10`.
* **Phòng nhận:** `board:{boardId}`
* **Cấu trúc Sự kiện:**
  ```json
  {
    "event": "LIST_ARCHIVED",
    "eventId": "6a7b8c9d-0e1f-2a3b-4c5d-6e7f8a9b0c1d",
    "occurredAt": "2026-09-29T10:26:00.000Z",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "actor": {
      "userId": "88e83344-99bb-44cc-88dd-112233445566",
      "fullName": "Phan Gia Đạt"
    },
    "data": {
      "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "status": "ARCHIVED",
      "isArchived": true,
      "updatedAt": "2026-09-29T10:26:00.000Z"
    }
  }
  ```
  *(Ghi chú: Trường `status: "ARCHIVED"` khớp chính xác thuộc tính enum `status` trong schema `List` của OpenAPI; trường `isArchived: true` là cờ tiện ích cho Frontend).*

---

## 9. Quy ước Sắp xếp Vị trí Thẻ & Cột (Ordering & Position Contract)

Khả năng đồng bộ thứ tự kéo thả là yếu tố quan trọng nhất của bảng Kanban:

1. **Trường Dữ liệu Vị trí `position`:**
   * Trong thực thể `Card` và `List`, vị trí được biểu diễn bằng trường số `position: number` (khớp với DTO trong OpenAPI).
   * Vị trí ban đầu được tính toán theo khoảng cách giãn cách (ví dụ bội số của `65536` hoặc thứ tự số nguyên dương).
2. **Quy tắc Di chuyển Thẻ (`CARD_MOVED`):**
   * Client gửi lệnh REST `PATCH /api/v1/cards/{id}/move` kèm `targetListId` và `position` mong muốn.
   * Máy chủ chuẩn hóa vị trí, cập nhật DB, và phát sự kiện `CARD_MOVED` chứa `fromListId`, `toListId`, `oldPosition` và `newPosition` chính xác.
   * Client nhận sự kiện tiến hành sắp xếp lại danh sách thẻ trong DOM/State theo `position`.
3. **Phân định Thuật toán:**
   * Hợp đồng API không áp đặt thuật toán phức tạp như LexoRank ở tầng client. Máy chủ đóng vai trò thẩm quyền trong việc tính toán và phân bổ giá trị số `position`.

---

## 10. Mối quan hệ Kiểm soát Tương tranh Lạc quan (OCC vs Realtime Events)

Hệ thống kết hợp kiểm soát tương tranh chặt chẽ để đảm bảo không bị ghi đè dữ liệu sai lệch (Race Conditions):

```text
User A (Client A)          User B (Client B)                 Server (PostgreSQL)
       │                           │                                  │
       │── (1) Move Card X ───────┼─────────────────────────────────>│ Update DB (updatedAt = T1)
       │                           │                                  │
       │<── (2) HTTP 200 OK ───────┼──────────────────────────────────│
       │                           │                                  │
       │~~~ (3) WS CARD_MOVED ~~~~>│<~~~ (3) WS CARD_MOVED ~~~~~~~~~~~│ Broadcast Event (T1)
       │                           │                                  │
       │                           │── (4) Sửa Card X (stale T0) ────>│ Kiểm tra updatedAt:
       │                           │                                  │ T0 < T1  ==> CONFLICT!
       │                           │<── (5) HTTP 409 Conflict ────────│ Trả về CARD_CONFLICT
```

* **Quy tắc Bất biến:** Sự kiện WebSocket **KHÔNG** làm nhiệm vụ giải quyết xung đột ghi đè. Máy chủ là thẩm quyền tối cao thông qua kiểm tra dấu thời gian `updatedAt` trong header/body REST API.
* **Xử lý khi xung đột:** Nếu Client B thao tác sửa thẻ dựa trên phiên bản cũ trước khi kịp áp dụng sự kiện WebSocket, REST API sẽ từ chối bằng lỗi `409 Conflict` (`CARD_CONFLICT`). Client B nhận phản hồi 409 và thực hiện lấy lại trạng thái mới nhất từ REST snapshot.

---

## 11. Quy trình Tái kết nối & Khôi phục Dữ liệu (Reconnection & Snapshot Recovery Flow)

WebSocket hoạt động qua mạng Internet không ổn định. Giao thức mạng có thể bị ngắt đột ngột mà không có cảnh báo.

```text
┌────────────────────────────────────────────────────────┐
│           KẾT NỐI WEBSOCKET BỊ MẤT (DISCONNECTED)      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (1) Tự động thử kết nối lại (Exponential Backoff)
┌────────────────────────────────────────────────────────┐
│          KẾT NỐI LẠI THÀNH CÔNG VỚI /realtime          │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (2) Bắt tay & Tái xác thực Token qua URL (?token=)
┌────────────────────────────────────────────────────────┐
│        GIA NHẬP LẠI PHÒNG: JOIN_BOARD(boardId)         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (3) Lấy bản chụp dữ liệu thẩm quyền (REST Snapshot)
┌────────────────────────────────────────────────────────┐
│     GET /api/v1/boards/{id}/lists (+ Thẻ Kanban)       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (4) Đồng bộ State & Tiếp tục nghe WebSocket
┌────────────────────────────────────────────────────────┐
│                  ĐỒNG BỘ HOÀN TẤT                      │
└────────────────────────────────────────────────────────┘
```

### Các Bước Khôi phục Chi tiết:
1. **Phát hiện Mất kết nối:** Client kích hoạt cơ chế thử lại lũy thừa (`Exponential Backoff`, ví dụ: 1s, 2s, 4s, tối đa 30s).
2. **Tái Xác thực:** Khi kết nối vật lý được tái lập, hoàn tất bắt tay xác thực bằng JWT hiện hành trong Query Parameter `?token=<access_token>` (nếu token hết hạn, client gọi `POST /api/v1/auth/refresh` trước).
3. **Gia nhập Lại Phòng:** Gửi thông điệp `JOIN_BOARD` với `boardId` đang xem.
4. **Lấy Snapshot Thẩm quyền (Authoritative Snapshot):**
   * Client gọi REST API lấy cấu trúc Kanban:
     ```http
     GET /api/v1/boards/{id}/lists
     ```
   * **Đối chiếu Hợp đồng & Hiện trạng Schema (Contract Audit):**
     - Trong `docs/api/openapi/`, mô tả của `GET /boards/{id}/lists` ghi nhận: *"Retrieves all active columns and nested cards for rendering the complete Kanban board view"* (phản hồi 200: *"Kanban columns and card tree"*).
     - Tuy nhiên, schema `$ref: '#/components/schemas/ListListResponse'` hiện tại chỉ định nghĩa mảng các đối tượng `List` phẳng, **chưa chứa mảng thẻ `cards: Card[]` lồng nhau**.
     - **Giải pháp Khôi phục Hiện hành:** Client tải danh sách Cột qua `GET /api/v1/boards/{id}/lists`, kết hợp tải danh sách Thẻ của Bảng qua `GET /api/v1/boards/{id}/cards/search` (hoặc tải theo từng cột).
     - Trường hợp mở rộng `List` trả về `cards` lồng nhau trực tiếp trong `ListListResponse` được đánh dấu là:  
       `[UNVERIFIED: Schema ListListResponse trong OpenAPI hiện tại thiếu thuộc tính cards lồng nhau]`.
5. **Đồng bộ hóa Trạng thái:** Client ghi đè state nội bộ bằng snapshot nhận được, đảm bảo không bỏ sót bất kỳ sự kiện nào xảy ra trong giai đoạn mất mạng, sau đó tiếp tục xử lý các sự kiện thời gian thực mới.

---

## 12. Kiểm soát Sự kiện Trùng lặp & Đến chậm (Out-of-order & Deduplication)

Trong điều kiện mạng trễ, client có thể nhận sự kiện trùng hoặc sự kiện cũ đến sau:
1. **Kiểm tra Trùng lặp (`Deduplication`):**
   * Mỗi sự kiện mang một `eventId: UUID`.
   * Frontend duy trì một danh sách đệm ngắn (ví dụ: LRU cache gồm 100 `eventId` gần nhất). Nếu nhận được sự kiện có `eventId` đã xử lý, client âm thầm bỏ qua.
2. **Kiểm tra Thứ tự Phiên bản (`Timestamp/Version Check`):**
   * Các sự kiện đồng bộ đều mang trường dấu thời gian `updatedAt` để đối chiếu phiên bản:
     - Với sự kiện toàn phần (`CARD_CREATED`, `CARD_UPDATED`): vị trí tại `data.card.updatedAt`.
     - Với sự kiện biến đổi trạng thái (`CARD_MOVED`, `CARD_ARCHIVED`): vị trí tại `data.updatedAt`.
     - Với sự kiện cột (`LIST_REORDERED`, `LIST_ARCHIVED`): vị trí tại `data.updatedAt`.
     - Với sự kiện bình luận (`COMMENT_ADDED`): vị trí tại `data.comment.updatedAt`.
   * Nếu client nhận sự kiện mà `updatedAt` của sự kiện nhỏ hơn hoặc bằng `updatedAt` của thực thể tương ứng hiện có trong state bộ nhớ của client, sự kiện đó được coi là **sự kiện cũ đến muộn (stale event)** và bị bỏ qua.

---

## 13. Xử lý Lỗi & Thông điệp Báo lỗi (Error Handling Contract)

Hệ thống phân định 3 cấp độ xử lý lỗi kỹ thuật:

### 13.1. Cấp độ 1 — Lỗi Bắt tay Nâng cấp HTTP (HTTP Upgrade Handshake Rejection)
Xảy ra trước khi kết nối WebSocket được thiết lập. Máy chủ phản hồi mã trạng thái HTTP chuẩn và ngắt kết nối:
* `401 Unauthorized`: Thiếu token, token không hợp lệ, hoặc chữ ký sai (`TOKEN_EXPIRED`). Khớp `OpenAPI contract`.
* `403 Forbidden`: Người dùng bị cấm hoạt động hoặc tài khoản bị khóa. Khớp `OpenAPI contract`.

### 13.2. Cấp độ 2 — Lỗi Cưỡng chế Đóng Socket Đang Hoạt động (WebSocket Close Frames)
Sử dụng mã đóng RFC 6455 thuộc dải riêng của ứng dụng (`4000-4999`):
* `4401 UNAUTHORIZED`: Token hết hạn trong khi kết nối đang duy trì mà client không thực hiện refresh định kỳ, hoặc token bị thu hồi.
* `4429 RATE_LIMIT_EXCEEDED`: Client vi phạm giới hạn tần suất gửi tin nhắn (spam các gói tin `JOIN_BOARD`/`LEAVE_BOARD`).

### 13.3. Cấp độ 3 — Lỗi Thao tác Nghiệp vụ Phòng (In-Session Application Errors)
Kết nối WebSocket vẫn được duy trì bình thường, máy chủ gửi thông điệp lỗi có cấu trúc chuẩn tới socket client vi phạm:

```json
{
  "event": "ERROR",
  "error": {
    "code": "MÃ_LỖI",
    "message": "Mô tả lỗi dễ hiểu cho người dùng."
  }
}
```

#### Bảng Danh mục Mã lỗi Ứng dụng trong Phiên:
| Mã lỗi (`code`) | Ý nghĩa & Nguyên nhân | Hành vi Hệ thống |
| :--- | :--- | :--- |
| `FORBIDDEN` | Người dùng không thuộc Bảng yêu cầu hoặc không có quyền RBAC. | Không cho phép tham gia phòng. Giữ kết nối ở cấp độ socket. |
| `BOARD_NOT_FOUND` | Bảng yêu cầu không tồn tại hoặc đã bị xóa vĩnh viễn. | Thông báo lỗi; client nên điều hướng về danh sách Workspace. |
| `INVALID_ACTION` | Thao tác client gửi lên không thuộc danh mục hỗ trợ (`JOIN_BOARD`, `LEAVE_BOARD`). | Trả về thông báo lỗi, bỏ qua payload. |
| `INVALID_PAYLOAD` | Cấu trúc gói tin client gửi lên sai định dạng JSON hoặc thiếu trường bắt buộc (`boardId`). | Trả về thông báo lỗi chi tiết. |

---

## 14. Kiểm tra Độ sống Kết nối (Heartbeat / Ping-Pong)

Nhằm phát hiện kết nối bị "treo âm thầm" (Half-open connections) do rớt mạng đột ngột:
1. **Giao thức Chuẩn RFC 6455 Ping/Pong:**
   * Máy chủ gửi khung điều khiển `Ping` định kỳ (ví dụ mỗi **30 giây**).
   * Trình duyệt hoặc thư viện client tự động phản hồi khung `Pong`.
2. **Cơ chế Ngắt Kết nối Treo:**
   * Nếu máy chủ gửi 2 lần `Ping` liên tiếp mà không nhận được `Pong` tương ứng, máy chủ chủ động đóng socket và giải phóng tài nguyên phòng.

---

## 15. Ràng buộc An toàn & Bảo mật (Security & Privacy)

1. **Không Chứa Bí mật trong Payload:**
   * Payload của sự kiện tuyệt đối không bao giờ chứa thông tin nhạy cảm: `password`, `refreshToken`, `accessToken`, `webhookSecret`, thông tin thẻ ngân hàng hoặc cấu hình nội bộ.
2. **Thu hồi Quyền hạn Tức thì:**
   * Khi một thành viên bị xóa khỏi Bảng (`DELETE /api/v1/boards/{id}/members/{userId}`), máy chủ lập tức cưỡng chế trục xuất (`kick`) kết nối của người dùng đó ra khỏi phòng `board:{boardId}` tương ứng.
3. **Mã hóa Đường truyền Bắt buộc:**
   * Trên môi trường triển khai thực tế, toàn bộ lưu lượng WebSocket bắt buộc phải đi qua giao thức bảo mật `WSS (WebSocket Secure)` thông qua chứng chỉ SSL/TLS.

---

## 16. Bảng Đối chiếu Quan hệ REST ↔ WebSocket (REST ↔ WebSocket Matrix)

Bảng dưới đây xác lập mối quan hệ chặt chẽ giữa các Thao tác REST của hệ thống và Sự kiện WebSocket tương ứng được kích hoạt:

| Module | Thao tác REST API | Endpoint REST (OpenAPI Contract) | Trạng thái | Sự kiện WebSocket Kích hoạt | Phòng Đích | Ghi chú Nghiệp vụ |
| :---: | :--- | :--- | :---: | :--- | :--- | :--- |
| **LIST** | Sắp xếp lại thứ tự Cột | `PATCH /api/v1/lists/{id}/position` | 200 OK | `LIST_REORDERED` | `board:{boardId}` | Cập nhật vị trí hiển thị cột Kanban |
| **LIST** | Lưu trữ Cột quy trình | `PATCH /api/v1/lists/{id}/archive` | 200 OK | `LIST_ARCHIVED` | `board:{boardId}` | Ẩn cột và các thẻ thuộc cột |
| **CARD** | Tạo mới Thẻ việc | `POST /api/v1/lists/{id}/cards` | 201 Created | `CARD_CREATED` | `board:{boardId}` | Thẻ xuất hiện ngay lập tức tại cột |
| **CARD** | Di chuyển / Kéo thả Thẻ | `PATCH /api/v1/cards/{id}/move` | 200 OK | `CARD_MOVED` | `board:{boardId}` | Kéo thả thẻ giữa các cột hoặc đổi thứ tự |
| **CARD** | Cập nhật thông tin Thẻ | `PATCH /api/v1/cards/{id}` | 200 OK | `CARD_UPDATED` | `board:{boardId}` | Đổi tiêu đề, hạn chót, độ ưu tiên, nhãn |
| **CARD** | Lưu trữ Thẻ việc | `PATCH /api/v1/cards/{id}/archive` | 200 OK | `CARD_ARCHIVED` | `board:{boardId}` | Đưa thẻ vào mục lưu trữ, ẩn khỏi Kanban |
| **CARD** | Xóa vĩnh viễn Thẻ việc | `DELETE /api/v1/cards/{id}` | 200 OK | `CARD_DELETED` | `board:{boardId}` | Thẻ bị xóa hoàn toàn khỏi hệ thống |
| **COL** | Thêm bình luận vào Thẻ | `POST /api/v1/cards/{id}/comments` | 201 Created | `COMMENT_ADDED` | `board:{boardId}` | Cập nhật số lượng và danh sách trao đổi |
| **COL** | Chuyển Quick Note thành Card | `POST /api/v1/users/me/quick-notes/{id}/convert-to-card` | 201 Created | `CARD_CREATED` | `board:{boardId}` | Note cá nhân trở thành Thẻ chính thức |

---

## 17. Ma trận Truy vết Use Case & Yêu cầu Kỹ thuật (Traceability Matrix)

| Thành phần Đặc tả WebSocket | Mã Use Case Liên quan | Yêu cầu Kỹ thuật (SRS) | Phân loại Phạm vi | Ghi chú Kiểm định |
| :--- | :---: | :---: | :---: | :--- |
| **Kết nối Kênh & Bắt tay WebSocket** | `UC-COL-15` | `FR-03`, `NFR-02`, `SEC-02` | `[SRS-CORE]` | Endpoint `/realtime`, xác thực Query Param `?token=` |
| **Độ trễ Đồng bộ Thời gian thực < 500ms** | `UC-COL-15` | `NFR-02` (Mục 6.1.2) | `[SRS-CORE]` | Tiêu chuẩn chất lượng phi chức năng thiết kế |
| **Sự kiện Kéo thả Thẻ việc (`CARD_MOVED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Đồng bộ tức thời vị trí thẻ giữa các cột |
| **Sự kiện Thẻ được Tạo mới (`CARD_CREATED`)** | `UC-COL-15`, `UC-Card-12`, `UC-PLAN-19` | `FR-02`, `FR-03` | `[SRS-CORE]` | Phản ánh thẻ mới từ REST Card và Quick Note |
| **Sự kiện Cập nhật Thẻ (`CARD_UPDATED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Đồng bộ thuộc tính thẻ (tiêu đề, hạn, nhãn) |
| **Sự kiện Lưu trữ Thẻ việc (`CARD_ARCHIVED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Ẩn thẻ khỏi giao diện hoạt động Kanban |
| **Sự kiện Xóa Vĩnh viễn Thẻ (`CARD_DELETED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Xóa hoàn toàn thẻ khỏi mọi view |
| **Sự kiện Bình luận Mới (`COMMENT_ADDED`)** | `UC-COL-16` | `FR-03` | `[SRS-CORE]` | Hiển thị bình luận tức thời không cần F5 [UNVERIFIED: PII email] |
| **Sự kiện Cột Quy trình (`LIST_REORDERED` / `LIST_ARCHIVED`)** | `UC-List-10` | `FR-02` | `[SRS-CORE]` | Đồng bộ cột quy trình khi PM sắp xếp/lưu trữ |
| **Khung Phong bì Sự kiện Chuẩn hóa** | `UC-COL-15` | Quy ước API | `[PROPOSED API DESIGN]` | Định dạng chuẩn (`event`, `eventId`, `occurredAt`, `boardId`, `actor`, `data`) |
| **Quy trình Snapshot Recovery khi Tái kết nối** | `UC-COL-15` | Kiến trúc Phục hồi | `[PROPOSED API DESIGN]` | Gọi `GET /boards/{id}/lists` [UNVERIFIED: Schema List hiện thiếu lồng cards] |
| **Cơ chế Chống Sự kiện Trùng lặp (`Deduplication`)** | `UC-COL-15` | Kiến trúc Toàn vẹn | `[PROPOSED API DESIGN]` | Bộ nhớ đệm `eventId` và so sánh `updatedAt` |

---

## 18. Kết luận & Cam kết Phạm vi

1. **Tài liệu Hợp đồng Độc lập:** Tệp đặc tả này (`docs/api/websocket.md`) đóng vai trò là chuẩn giao tiếp chính thức giữa đội ngũ Frontend và Backend cho toàn bộ tính năng thời gian thực của dự án Nexora.
2. **Tuân thủ Giới hạn Phase 6:** Giai đoạn này **hoàn toàn là tài liệu hóa**. Chưa có mã nguồn thư viện WebSocket (Socket.IO hoặc `ws`), chưa có Prisma model mới, và chưa có logic xử lý runtime nào được đưa vào mã nguồn ứng dụng.
