# Nexora — Đặc tả Kỹ thuật Hợp đồng WebSocket Realtime (Phase 6)
## Phân hệ Đồng bộ Thời gian thực & Cộng tác Bảng Kanban

> **Phiên bản tài liệu:** 1.0.0  
> **Trạng thái:** Formal Specification (Documentation Only)  
> **Kênh phạm vi:** Cấp độ Bảng dự án (`board:{board_id}`)  
> **Tài liệu tham chiếu:** `docs/api/openapi.yaml`, `docs/api/endpoint-matrix.md`, `docs/api/conventions.md`, SRS v1.0 (Mục 3.1.3, 3.5, 6.1.2)  
> **Use Case trọng tâm:** `UC-COL-15`, `UC-COL-16`, `UC-COL-17`, `UC-Card-12`, `UC-List-10`

---

## 1. Tổng quan Kiến trúc & Nguyên tắc Vận hành (Overview)

### 1.1. Mục đích Hiện diện của WebSocket trong Nexora
Nexora là nền tảng quản lý dự án thông minh đa người dùng. Khi nhiều thành viên trong cùng một Bảng (Board) làm việc đồng thời, các hành động như **kéo thả thẻ việc giữa các cột, tạo thẻ mới, chỉnh sửa thông tin hoặc thêm bình luận** cần được phản ánh ngay lập tức trên màn hình của tất cả các thành viên đang hoạt động nhằm tránh xung đột thao tác và tăng cường trải nghiệm cộng tác.

### 1.2. Nguyên tắc Tách biệt Trách nhiệm: REST API vs WebSocket
Hệ thống Nexora phân định ranh giới kiến trúc tuyệt đối giữa hai giao thức:

```text
┌──────────────────────────────────────────────────────────┐
│                        CLIENT                            │
└────────────┬─────────────────────────────────▲───────────┘
             │                                 │
     (1) REST API Commands             (3) Realtime Events
  (Authoritative State Mutation)     (Broadcast Synchronization)
             │                                 │
             ▼                                 │
┌─────────────────────────┐         ┌──────────────────────┐
│     REST Controller     │         │   WebSocket Server   │
└────────────┬────────────┘         └──────────▲───────────┘
             │                                 │
       (2) Database                      (2b) Publish Event
    Mutation (PostgreSQL)               (Redis / In-memory)
             │                                 │
             └─────────────────────────────────┘
```

1. **REST API — Nguồn Thẩm quyền Dữ liệu (Authoritative State):**
   * Mọi thao tác thay đổi dữ liệu (Command/Mutation) như tạo thẻ, di chuyển thẻ, sửa thẻ, xóa thẻ, đổi vai trò, thêm bình luận **bắt buộc phải gửi qua REST API**.
   * REST API chịu trách nhiệm: Kiểm tra quyền hạn RBAC, xác thực nghiệp vụ, kiểm tra xung đột tương tranh lạc quan (Optimistic Concurrency Control — OCC qua `updatedAt`), và lưu trữ bền vững (persistence) vào cơ sở dữ liệu PostgreSQL.
2. **WebSocket — Kênh Lan truyền Sự kiện (Realtime Event Distribution):**
   * WebSocket **KHÔNG** phải là kênh tiếp nhận các lệnh thay đổi trạng thái thay thế cho REST.
   * WebSocket chỉ đóng vai trò kênh phát sóng (Pub/Sub Broadcast) một chiều từ Server tới Client sau khi một giao dịch REST đã được xác nhận lưu trữ thành công trong hệ thống.
3. **Phạm vi Lan truyền (Board-Level Scope):**
   * Các sự kiện Kanban chỉ phát sóng trong phạm vi phòng Bảng cụ thể (`board:{board_id}`). Thành viên ở Bảng A không bao giờ nhận được sự kiện xảy ra ở Bảng B.
4. **Mục tiêu Hiệu năng (Latency Target):**
   * Độ trễ lan truyền sự kiện đồng bộ từ khi máy chủ ghi nhận REST thành công đến khi các client khác nhận được qua WebSocket phải đạt **dưới 500ms** (Căn cứ: SRS Mục 6.1.2, yêu cầu phi chức năng `NFR-02`, tiêu chuẩn `[SRS-CORE]`).

---

## 2. Điểm Kết nối & Nâng cấp Giao thức (Connection & Protocol)

### 2.1. Endpoint Kết nối
Kênh kết nối WebSocket sử dụng đường dẫn thống nhất với hợp đồng OpenAPI:

```text
Endpoint: /realtime
```

* **Môi trường Phát triển (Development):**
  ```text
  ws://localhost:3000/realtime
  ```
* **Môi trường Sản xuất (Production):**
  ```text
  wss://api.nexora.local/realtime
  ```
  *(Sử dụng giao thức mã hóa an toàn WSS qua reverse proxy HTTPS/TLS).*

### 2.2. Bắt tay Nâng cấp (HTTP Upgrade Handshake)
Quá trình thiết lập kết nối tuân theo chuẩn RFC 6455 thông qua HTTP 1.1 Upgrade:
* **Phương thức:** `GET`
* **Đường dẫn:** `/realtime`
* **Headers bắt tay:**
  ```http
  GET /realtime HTTP/1.1
  Host: localhost:3000
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
  Sec-WebSocket-Version: 13
  Authorization: Bearer <access_token>
  ```
* **Phản hồi Thành công (101 Switching Protocols):**
  ```http
  HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
  ```
* **Phản hồi Lỗi (HTTP Error Codes):**
  * `401 Unauthorized`: Token xác thực bị thiếu, không hợp lệ hoặc đã hết hạn (`TOKEN_EXPIRED`).
  * `403 Forbidden`: Người dùng bị khóa tài khoản hoặc không có quyền truy cập hệ thống.

---

## 3. Cơ chế Xác thực (Handshake Authentication)

### 3.1. Yêu cầu Xác thực Cốt lõi
* Tất cả kết nối WebSocket đều phải được xác thực danh tính người dùng bằng **JWT Access Token** hợp lệ (thời hạn 15 phút, cấp từ `POST /api/v1/auth/login` hoặc `POST /api/v1/auth/refresh`).
* Không cho phép kết nối ẩn danh (Anonymous connection) vào phân hệ đồng bộ Kanban.

### 3.2. Phương thức Truyền tải Token (Transport Mechanism)
> [!IMPORTANT]
> **Quy định Phân định Kỹ thuật (Implementation Decision Note):**  
> Do API WebSocket nguyên bản trên trình duyệt web (native `window.WebSocket`) không hỗ trợ tùy biến HTTP Headers trong yêu cầu bắt tay `GET`, giải pháp triển khai thực tế giữa Frontend và Backend có 2 lựa chọn được chấp thuận:
> 1. **Cách 1 — Query Parameter (Khuyến nghị cho Web Native):**  
>    Truyền token qua URL: `ws://localhost:3000/realtime?token=<access_token>`
> 2. **Cách 2 — Khung xác thực đầu tiên (First-Frame Authentication):**  
>    Cho phép kết nối WebSocket mở ở trạng thái chưa xác thực, và client bắt buộc phải gửi thông điệp `AUTH` kèm JWT trong vòng 5 giây trước khi thực hiện bất kỳ thao tác nào khác.
> 
> *Tài liệu này xác nhận: Cả hai cách tiếp cận đều tuân thủ yêu cầu xác thực Bearer Token của hệ thống.*

---

## 4. Phân quyền Truy cập Phòng Bảng (Board Authorization & RBAC)

Xác thực danh tính (Authentication) là **điều kiện cần nhưng chưa đủ**. Một người dùng đăng nhập hợp lệ không được phép tự do lắng nghe sự kiện của bất kỳ Bảng nào mà họ không phải là thành viên.

### 4.1. Quy tắc Phân quyền Gia nhập Kênh
Trước khi đưa kết nối vào phòng `board:{board_id}`, máy chủ WebSocket bắt buộc phải kiểm tra quyền hạn nội bộ (RBAC):
* **Workspace Owner:** Có toàn quyền truy cập tất cả các Bảng thuộc Workspace do mình sở hữu.
* **Board PM (Project Manager):** Có toàn quyền truy cập và quản lý Bảng được phân công.
* **Board Member:** Có quyền tham gia lắng nghe sự kiện và tương tác với các thẻ việc trong Bảng.
* **Người dùng ngoài Bảng (Non-member):** Bị từ chối gia nhập phòng với mã lỗi `FORBIDDEN` hoặc `BOARD_NOT_FOUND`.

### 4.2. Kháng rủi ro Rò rỉ Thông tin
* Máy chủ không trả về chi tiết thông tin Bảng khi từ chối quyền nhằm ngăn chặn tấn công dò quét mã UUID (`ID Enumeration`).

---

## 5. Cấu trúc Phòng & Kênh Truyền thông (Rooms & Channels)

Mỗi Bảng Kanban tương ứng với một phòng logic độc lập:

```text
Tên phòng: board:{board_id}
```

* **Quy ước định danh:** Sử dụng tiền tố `board:` kết hợp mã định danh UUID v4 của Bảng.
* **Ví dụ phòng hợp lệ:**
  ```text
  board:c56a4180-65aa-42ec-a945-5fd21dec0538
  ```
* **Đặc tính cách ly:**
  * Mỗi thông điệp cập nhật Thẻ, Cột hoặc Bình luận chỉ được phát tán (`broadcast`) tới các kết nối đang hiện diện trong chính phòng `board:{board_id}` đó.
  * Khi người dùng đóng tab hoặc chuyển sang màn hình Bảng khác, kết nối phải rời khỏi phòng cũ.

---

## 6. Thông điệp Chiều Client $\rightarrow$ Server (Client-to-Server Messages)

Chiều Client $\rightarrow$ Server qua WebSocket được thiết kế **tối giản** nhằm tập trung vào việc quản lý trạng thái kết nối phòng. Mọi thao tác nghiệp vụ đều chuyển qua REST.

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
      "timestamp": "2026-09-29T10:30:00.000Z"
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
    "timestamp": "2026-09-29T10:35:00.000Z"
  }
  ```

---

## 7. Khung Phong bì Sự kiện Chiều Server $\rightarrow$ Client (Event Envelope)

Mọi sự kiện phát sóng từ máy chủ tới client đều tuân thủ cấu trúc phong bì JSON chuẩn, nhất quán với quy ước dữ liệu của dự án:

```json
{
  "event": "TÊN_SỰ_KIỆN",
  "eventId": "UUIDv4",
  "boardId": "UUIDv4",
  "timestamp": "ISO_8601_UTC",
  "data": {}
}
```

### Chi tiết các trường trong Phong bì (Envelope Schema):
| Tên trường | Kiểu dữ liệu | Bắt buộc | Mô tả & Quy ước |
| :--- | :---: | :---: | :--- |
| `event` | `string` | **Có** | Định danh sự kiện viết hoa, phân cách bằng dấu gạch dưới (ví dụ `CARD_MOVED`). |
| `eventId` | `string (uuid)` | **Có** | Mã UUID duy nhất của sự kiện, phục vụ chống trùng lặp tại frontend (`Deduplication`). |
| `boardId` | `string (uuid)` | **Có** | Mã UUID của Bảng đích nơi phát sinh sự kiện. |
| `timestamp` | `string (date-time)`| **Có** | Thời điểm máy chủ phát sự kiện theo chuẩn ISO 8601 UTC (ví dụ `2026-09-29T10:15:30.000Z`). |
| `data` | `object` | **Có** | Dữ liệu chi tiết của thực thể bị thay đổi, tái sử dụng định dạng DTO từ OpenAPI. |

---

## 8. Đặc tả Chi tiết các Sự kiện Thời gian thực (Realtime Events Catalog)

### 8.1. Sự kiện Thẻ được Tạo mới (`CARD_CREATED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `POST /api/v1/lists/:id/cards` (`UC-Card-12`)
  - Hoặc `POST /api/v1/users/me/quick-notes/:id/convert-to-card` (`UC-PLAN-19`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thẻ đã được ghi vào DB).
* **Cấu trúc Payload (`data`):**
  ```json
  {
    "event": "CARD_CREATED",
    "eventId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "timestamp": "2026-09-29T10:15:00.000Z",
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
  - `PATCH /api/v1/cards/:id/move` (`UC-Card-12`, `UC-COL-15`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Vị trí và danh sách cột đã cập nhật trong DB).
* **Ý nghĩa:** Cung cấp đầy đủ vị trí nguồn và đích để các máy khách vẽ lại hoạt ảnh kéo thả mượt mà trên Kanban.
* **Cấu trúc Payload (`data`):**
  ```json
  {
    "event": "CARD_MOVED",
    "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "timestamp": "2026-09-29T10:16:30.000Z",
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "sourceListId": "7d9b23a1-4567-4e89-b123-abcdef012345",
      "targetListId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "oldPosition": 65536,
      "newPosition": 131072,
      "updatedAt": "2026-09-29T10:16:30.000Z",
      "movedBy": {
        "id": "88e83344-99bb-44cc-88dd-112233445566",
        "fullName": "Phan Gia Đạt"
      }
    }
  }
  ```

---

### 8.3. Sự kiện Cập nhật Thẻ (`CARD_UPDATED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `PATCH /api/v1/cards/:id` (`UC-Card-12`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thông tin thẻ được cập nhật trong DB).
* **Cấu trúc Payload (`data`):**
  ```json
  {
    "event": "CARD_UPDATED",
    "eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "timestamp": "2026-09-29T10:18:00.000Z",
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

### 8.4. Sự kiện Xóa / Lưu trữ Thẻ (`CARD_DELETED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `DELETE /api/v1/cards/:id` (`UC-Card-12`)
  - Hoặc `PATCH /api/v1/cards/:id/archive` (`UC-Card-12`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Thẻ đã bị xóa hoặc chuyển sang trạng thái ARCHIVED).
* **Cấu trúc Payload (`data`):**
  ```json
  {
    "event": "CARD_DELETED",
    "eventId": "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "timestamp": "2026-09-29T10:20:00.000Z",
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "reason": "ARCHIVED",
      "updatedAt": "2026-09-29T10:20:00.000Z"
    }
  }
  ```

---

### 8.5. Sự kiện Thêm Bình luận Thẻ (`COMMENT_ADDED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi gọi thành công REST endpoint:
  - `POST /api/v1/cards/:id/comments` (`UC-COL-16`)
* **Phòng nhận:** `board:{boardId}`
* **Dữ liệu bền vững:** Có (Bình luận được lưu trữ trong DB và hàng đợi thông báo đã kích hoạt).
* **Cấu trúc Payload (`data`):**
  ```json
  {
    "event": "COMMENT_ADDED",
    "eventId": "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "timestamp": "2026-09-29T10:22:00.000Z",
    "data": {
      "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
      "comment": {
        "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "cardId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
        "userId": "88e83344-99bb-44cc-88dd-112233445566",
        "content": "@datphan Vui lòng kiểm tra lại cấu hình OAuth Google trên Cloud Console.",
        "user": {
          "id": "88e83344-99bb-44cc-88dd-112233445566",
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

---

### 8.6. Sự kiện Cột Quy trình Bị Thay đổi (`LIST_REORDERED` & `LIST_ARCHIVED`) `[SRS-CORE]`
* **Kích hoạt:** Được phát sóng sau khi PM sắp xếp lại vị trí cột (`PATCH /api/v1/lists/:id/position`) hoặc lưu trữ cột (`PATCH /api/v1/lists/:id/archive`) theo `UC-List-10`.
* **Phòng nhận:** `board:{boardId}`
* **Cấu trúc Payload (`LIST_REORDERED`):**
  ```json
  {
    "event": "LIST_REORDERED",
    "eventId": "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
    "boardId": "c56a4180-65aa-42ec-a945-5fd21dec0538",
    "timestamp": "2026-09-29T10:25:00.000Z",
    "data": {
      "listId": "8e1c34b2-5678-4f90-c234-bcdef0123456",
      "oldPosition": 1,
      "newPosition": 2,
      "updatedAt": "2026-09-29T10:25:00.000Z"
    }
  }
  ```

---

## 9. Quy ước Sắp xếp Vị trí Thẻ & Cột (Ordering & Position Contract)

Khả năng đồng bộ thứ tự kéo thả là yếu tố sống còn của bảng Kanban:

1. **Trường Dữ liệu `position`:**
   * Trong thực thể `Card` và `List`, vị trí được biểu diễn bằng trường số `position: number`.
   * Vị trí ban đầu được tính toán theo khoảng cách giãn cách (ví dụ bội số của `65536` hoặc thứ tự số nguyên dương).
2. **Quy tắc Di chuyển Thẻ (`CARD_MOVED`):**
   * Client gửi lệnh REST `PATCH /api/v1/cards/:id/move` kèm `targetListId` và `position` mong muốn.
   * Máy chủ chuẩn hóa vị trí, cập nhật DB, và phát sự kiện `CARD_MOVED` chứa `oldPosition` và `newPosition` chính xác.
   * Client nhận sự kiện tiến hành sắp xếp lại danh sách thẻ trong DOM/State theo `position`.
3. **Phân định Thuật toán:**
   * Hợp đồng API không yêu cầu cứng nhắc thuật toán LexoRank ở tầng client; máy chủ chịu trách nhiệm phân định thứ tự số học `position` một cách thẩm quyền.

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
                            ▼ (2) Bắt tay & Tái xác thực Token JWT
┌────────────────────────────────────────────────────────┐
│        GIA NHẬP LẠI PHÒNG: JOIN_BOARD(boardId)         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (3) Lấy bản chụp dữ liệu thẩm quyền (REST Snapshot)
┌────────────────────────────────────────────────────────┐
│         GET /api/v1/boards/{id}/lists (Kèm Cards)      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (4) Đồng bộ State & Tiếp tục nghe WebSocket
┌────────────────────────────────────────────────────────┐
│                  ĐỒNG BỘ HOÀN TẤT                      │
└────────────────────────────────────────────────────────┘
```

### Các Bước Khôi phục Chi tiết:
1. **Phát hiện Mất kết nối:** Client kích hoạt cơ chế thử lại lũy thừa (`Exponential Backoff`, ví dụ: 1s, 2s, 4s, tối đa 30s).
2. **Tái Xác thực:** Khi kết nối vật lý được tái lập, hoàn tất bắt tay xác thực bằng JWT hiện hành (nếu token hết hạn, client phải gọi `POST /api/v1/auth/refresh` trước).
3. **Gia nhập Lại Phòng:** Gửi thông điệp `JOIN_BOARD` với `boardId` đang xem.
4. **Lấy Snapshot Thẩm quyền (Authoritative Snapshot):**
   * Client **bắt buộc** gọi REST API:
     ```http
     GET /api/v1/boards/{id}/lists
     ```
   * REST endpoint này trả về danh sách đầy đủ tất cả các Cột và Thẻ việc hiện hành của Bảng.
5. **Đồng bộ hóa Trạng thái:** Client ghi đè state nội bộ bằng snapshot nhận được, đảm bảo không bỏ sót bất kỳ sự kiện nào xảy ra trong giai đoạn mất mạng, sau đó tiếp tục xử lý các sự kiện thời gian thực mới.

---

## 12. Kiểm soát Sự kiện Trùng lặp & Đến chậm (Out-of-order & Deduplication)

Trong điều kiện mạng trễ, client có thể nhận sự kiện trùng hoặc sự kiện cũ đến sau:
1. **Kiểm tra Trùng lặp (`Deduplication`):**
   * Mỗi sự kiện mang một `eventId: UUID`.
   * Frontend duy trì một danh sách đệm ngắn (ví dụ: LRU cache gồm 100 `eventId` gần nhất). Nếu nhận được sự kiện có `eventId` đã xử lý, client âm thầm bỏ qua.
2. **Kiểm tra Thứ tự Phiên bản (`Timestamp/Version Check`):**
   * Mỗi thực thể trong `data` đều có trường `updatedAt`.
   * Nếu client nhận sự kiện `CARD_UPDATED` hoặc `CARD_MOVED` mà `updatedAt` của sự kiện nhỏ hơn hoặc bằng `updatedAt` của thẻ hiện có trong state bộ nhớ của client, sự kiện đó được coi là **sự kiện cũ đến muộn (stale event)** và bị bỏ qua.

---

## 13. Xử lý Lỗi & Thông điệp Báo lỗi (Error Handling Contract)

Khi xảy ra lỗi ở tầng WebSocket, máy chủ gửi thông điệp lỗi có cấu trúc chuẩn tới client vi phạm:

```json
{
  "event": "ERROR",
  "error": {
    "code": "MÃ_LỖI",
    "message": "Mô tả lỗi dễ hiểu cho người dùng."
  }
}
```

### Bảng Danh mục Mã lỗi WebSocket:
| Mã lỗi (`code`) | Ý nghĩa & Nguyên nhân | Hành vi Hệ thống |
| :--- | :--- | :--- |
| `UNAUTHORIZED` | Token JWT thiếu, sai định dạng, hết hạn hoặc chữ ký không hợp lệ. | Đóng kết nối với Close Code `4401`. Yêu cầu client làm mới token. |
| `FORBIDDEN` | Người dùng không thuộc Bảng yêu cầu hoặc tài khoản bị khóa. | Không cho phép tham gia phòng. Giữ kết nối ở cấp độ socket. |
| `BOARD_NOT_FOUND` | Bảng yêu cầu không tồn tại hoặc đã bị xóa vĩnh viễn. | Thông báo lỗi; client nên điều hướng về danh sách Workspace. |
| `INVALID_ACTION` | Thao tác client gửi lên không thuộc danh mục hỗ trợ (`JOIN_BOARD`, `LEAVE_BOARD`). | Trả về thông báo lỗi, bỏ qua payload. |
| `INVALID_PAYLOAD` | Cấu trúc gói tin client gửi lên sai định dạng JSON hoặc thiếu trường bắt buộc. | Trả về thông báo lỗi chi tiết. |
| `RATE_LIMIT_EXCEEDED` | Client gửi quá nhiều thông điệp vượt ngưỡng cho phép (spam JOIN/LEAVE). | Đóng kết nối tạm thời với Close Code `4429`. |

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
   * Khi một thành viên bị xóa khỏi Bảng (`DELETE /api/v1/boards/:id/members/:userId`), máy chủ lập tức cưỡng chế trục xuất (`kick`) kết nối của người dùng đó ra khỏi phòng `board:{board_id}` tương ứng.
3. **Mã hóa Đường truyền Bắt buộc:**
   * Trên môi trường triển khai thực tế, toàn bộ lưu lượng WebSocket bắt buộc phải đi qua giao thức bảo mật `WSS (WebSocket Secure)` thông qua chứng chỉ SSL/TLS.

---

## 16. Bảng Đối chiếu Quan hệ REST ↔ WebSocket (REST ↔ WebSocket Matrix)

Bảng dưới đây xác lập mối quan hệ chặt chẽ giữa các Thao tác REST của hệ thống và Sự kiện WebSocket tương ứng được kích hoạt:

| Module | Thao tác REST API | Endpoint REST | Trạng thái | Sự kiện WebSocket Kích hoạt | Phòng Đích | Ghi chú Nghiệp vụ |
| :---: | :--- | :--- | :---: | :--- | :--- | :--- |
| **LIST** | Sắp xếp lại thứ tự Cột | `PATCH /api/v1/lists/:id/position` | 200 OK | `LIST_REORDERED` | `board:{boardId}` | Cập nhật vị trí hiển thị cột Kanban |
| **LIST** | Lưu trữ Cột quy trình | `PATCH /api/v1/lists/:id/archive` | 200 OK | `LIST_ARCHIVED` | `board:{boardId}` | Ẩn cột và các thẻ thuộc cột |
| **CARD** | Tạo mới Thẻ việc | `POST /api/v1/lists/:id/cards` | 201 Created | `CARD_CREATED` | `board:{boardId}` | Thẻ xuất hiện ngay lập tức tại cột |
| **CARD** | Di chuyển / Kéo thả Thẻ | `PATCH /api/v1/cards/:id/move` | 200 OK | `CARD_MOVED` | `board:{boardId}` | Kéo thả thẻ giữa các cột hoặc đổi thứ tự |
| **CARD** | Cập nhật thông tin Thẻ | `PATCH /api/v1/cards/:id` | 200 OK | `CARD_UPDATED` | `board:{boardId}` | Đổi tiêu đề, hạn chót, độ ưu tiên, nhãn |
| **CARD** | Lưu trữ Thẻ việc | `PATCH /api/v1/cards/:id/archive` | 200 OK | `CARD_DELETED` | `board:{boardId}` | Đưa thẻ vào mục lưu trữ, xóa khỏi view |
| **CARD** | Xóa vĩnh viễn Thẻ việc | `DELETE /api/v1/cards/:id` | 200 OK | `CARD_DELETED` | `board:{boardId}` | Thẻ biến mất vĩnh viễn khỏi bảng |
| **COL** | Thêm bình luận vào Thẻ | `POST /api/v1/cards/:id/comments` | 201 Created | `COMMENT_ADDED` | `board:{boardId}` | Cập nhật số lượng và danh sách trao đổi |
| **COL** | Chuyển Quick Note thành Card | `POST /api/v1/users/me/quick-notes/:id/convert-to-card` | 201 Created | `CARD_CREATED` | `board:{boardId}` | Note cá nhân trở thành Thẻ chính thức |

---

## 17. Ma trận Truy vết Use Case & Yêu cầu Kỹ thuật (Traceability Matrix)

| Thành phần Đặc tả WebSocket | Mã Use Case Liên quan | Yêu cầu Kỹ thuật (SRS) | Phân loại Phạm vi | Ghi chú Kiểm định |
| :--- | :---: | :---: | :---: | :--- |
| **Kết nối Kênh & Bắt tay WebSocket** | `UC-COL-15` | `FR-03`, `NFR-02`, `SEC-02` | `[SRS-CORE]` | Endpoint `/realtime`, xác thực Bearer token |
| **Độ trễ Đồng bộ Thời gian thực < 500ms** | `UC-COL-15` | `NFR-02` (Mục 6.1.2) | `[SRS-CORE]` | Tiêu chuẩn chất lượng phi chức năng bắt buộc |
| **Sự kiện Kéo thả Thẻ việc (`CARD_MOVED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Đồng bộ tức thời vị trí thẻ giữa các cột |
| **Sự kiện Thẻ được Tạo mới (`CARD_CREATED`)** | `UC-COL-15`, `UC-Card-12`, `UC-PLAN-19` | `FR-02`, `FR-03` | `[SRS-CORE]` | Phản ánh thẻ mới từ REST Card và Quick Note |
| **Sự kiện Cập nhật Thẻ (`CARD_UPDATED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Đồng bộ thuộc tính thẻ (tiêu đề, hạn, nhãn) |
| **Sự kiện Xóa/Lưu trữ Thẻ (`CARD_DELETED`)** | `UC-COL-15`, `UC-Card-12` | `FR-02`, `FR-03` | `[SRS-CORE]` | Xóa thẻ hiển thị trên giao diện Kanban |
| **Sự kiện Bình luận Mới (`COMMENT_ADDED`)** | `UC-COL-16` | `FR-03` | `[SRS-CORE]` | Hiển thị bình luận tức thời không cần F5 |
| **Khung Phong bì Sự kiện Chuẩn hóa** | `UC-COL-15` | Quy ước API | `[PROPOSED API DESIGN]` | Định dạng chuẩn (`event`, `eventId`, `timestamp`, `data`) |
| **Quy trình Snapshot Recovery khi Tái kết nối** | `UC-COL-15` | Kiến trúc Phục hồi | `[PROPOSED API DESIGN]` | Gọi `GET /boards/:id/lists` sau khi reconnect |
| **Cơ chế Chống Sự kiện Trùng lặp (`Deduplication`)** | `UC-COL-15` | Kiến trúc Toàn vẹn | `[PROPOSED API DESIGN]` | Bộ nhớ đệm `eventId` và so sánh `updatedAt` |

---

## 18. Kết luận & Cam kết Phạm vi

1. **Tài liệu Hợp đồng Độc lập:** Tệp đặc tả này (`docs/api/websocket.md`) đóng vai trò là chuẩn giao tiếp chính thức giữa đội ngũ Frontend và Backend cho toàn bộ tính năng thời gian thực của dự án Nexora.
2. **Tuân thủ Giới hạn Phase 6:** Giai đoạn này **hoàn toàn là tài liệu hóa**. Chưa có mã nguồn thư viện WebSocket (Socket.IO hoặc `ws`), chưa có Prisma model mới, và chưa có logic xử lý runtime nào được đưa vào mã nguồn ứng dụng.
