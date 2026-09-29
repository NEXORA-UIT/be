# Nexora API Conventions & Protocol Specification

## 1. Mục đích và Phạm vi
Tài liệu này xác lập quy chuẩn kỹ thuật cho toàn bộ giao tiếp giữa Frontend (React SPA) và Backend (Node.js/Express) thuộc hệ thống **Nexora**. Toàn bộ các định danh, mã lỗi, mốc thời gian và giới hạn số học đều được kiểm chứng và trích dẫn trực tiếp từ `Tài liệu SRS Đồ án 1.pdf` cùng ma trận hợp đồng `docs/api/endpoint-matrix.md`.

---

## 2. Giao thức và Địa chỉ cơ sở (Base URL)
- **Giao thức:** HTTP/HTTPS 1.1 & 2.
- **Tiền tố phiên bản (Base Prefix):** `/api/v1` *(SRS Sec 4.2.2)*
  - Ví dụ: `http://localhost:3000/api/v1/workspaces`
- **Định dạng dữ liệu:** JSON (`Content-Type: application/json; charset=utf-8`) *(SRS Sec 4.2.1)*. Ngoại trừ các API tải tệp sử dụng `multipart/form-data`.

---

## 3. Định danh và Kiểu dữ liệu chuẩn

### 3.1. Định danh thực thể (Identifiers)
- Toàn bộ định danh tài nguyên chuẩn hóa theo chuỗi duy nhất định dạng **UUID v4** (chuỗi 36 ký tự) *(SRS Sec 4.2.1)*.
- Tuyệt đối không sử dụng số nguyên tự tăng (auto-increment integers) trong API transport.

### 3.2. Mốc thời gian và Múi giờ (Timestamps & Timezones)
- Toàn bộ dữ liệu ngày giờ lưu trữ và truyền nhận qua API bắt buộc sử dụng chuẩn **ISO 8601 UTC** *(SRS Sec 2.4.9, Sec 4.2.1)*.
- Định dạng chuẩn: `YYYY-MM-DDTHH:mm:ss.sssZ` (Ví dụ trong SRS: `2026-09-22T08:30:00.000Z`).
- Phía Client chịu trách nhiệm chuyển đổi sang múi giờ địa phương khi hiển thị giao diện người dùng.

---

## 4. Cấu trúc Đóng gói Phản hồi (Response Envelopes)

Mọi phản hồi từ máy chủ tuân thủ cấu trúc chuẩn mực quy định tại **SRS Sec 4.2.2**:

### 4.1. Phản hồi Thành công (Success Envelope)
Áp dụng cho các mã trạng thái `200 OK`, `201 Created`:
```json
{
  "success": true,
  "data": {}
}
```

#### Phản hồi danh sách có phân trang (Pagination Envelope)
Áp dụng cơ chế phân trang qua Query Parameters `?page=1&limit=20` *(SRS Sec 4.2.2, Sec 3.6.3)*:
```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 45,
      "totalPages": 3
    }
  }
}
```

### 4.2. Phản hồi Thất bại (Error Envelope)
Áp dụng cấu trúc lỗi chính thức từ **SRS Sec 4.2.2**:
```json
{
  "success": false,
  "error": {
    "code": "CARD_NOT_FOUND",
    "message": "Thông điệp mô tả lỗi",
    "details": []
  }
}
```
- `code`: Chuỗi ký tự viết hoa định danh duy nhất lỗi (xem Mục 8: Từ điển mã lỗi).
- `message`: Thông điệp mô tả lỗi thân thiện với người dùng.
- `details`: Mảng danh sách lỗi chi tiết (áp dụng khi kiểm thực form dữ liệu).

---

## 5. Chuẩn Mã Trạng Thái HTTP (HTTP Status Codes)

### 5.1. Mã trạng thái quy định trực tiếp trong SRS (Mục 4.2.2)
Tài liệu SRS Mục 4.2.2 xác định rõ 9 mã trạng thái tiêu chuẩn được sử dụng trong toàn bộ hệ thống:

| Mã trạng thái | Tên chuẩn | Phạm vi áp dụng theo SRS |
| :---: | :--- | :--- |
| **`200`** | OK | Truy vấn thành công (`GET`), cập nhật thành công (`PATCH`), xóa mềm thành công (`DELETE`), hoặc thực thi hành động. |
| **`201`** | Created | Khởi tạo mới tài nguyên thành công (`POST` Workspace, Board, Card, Task, Comment...). |
| **`400`** | Bad Request | Dữ liệu đầu vào sai định dạng, vi phạm ràng buộc nghiệp vụ (ví dụ: ngày bắt đầu lớn hơn hạn chót). |
| **`401`** | Unauthorized | Thiếu token, token không hợp lệ, hoặc token hết hạn trong header `Authorization`. |
| **`403`** | Forbidden | Người dùng bị từ chối quyền (vi phạm phân quyền RBAC/IDOR, Workspace bị đóng băng, tài khoản bị khóa). |
| **`404`** | Not Found | Không tìm thấy tài nguyên trong cơ sở dữ liệu. |
| **`409`** | Conflict | Xung đột dữ liệu đồng thời (OCC Concurrency Conflict), trùng lặp email, hoặc vi phạm ràng buộc trạng thái. |
| **`429`** | Too Many Requests | Vi phạm tần suất truy cập Rate Limit (Đăng nhập > 5 lần/phút/IP, hoặc vượt trần AI Quota). |
| **`500`** | Internal Server Error | Lỗi hệ thống nội bộ máy chủ chưa được kiểm soát. |

### 5.2. Mã trạng thái mở rộng theo thiết kế API [PROPOSED API DESIGN]
Các mã dưới đây được đề xuất nhằm tối ưu hóa tính ngữ nghĩa RESTful cho các tác vụ bất đồng bộ và tải tệp. Nếu cần tuân thủ nghiêm ngặt chỉ 9 mã của Mục 4.2.2, các mã này có thể fallback về mã gốc trong ngoặc đơn:
- **`202 Accepted`** *(Fallback: `200 OK`)*: Áp dụng cho `POST /boards/:id/documents` khi tệp được tiếp nhận và đẩy vào hàng đợi BullMQ để xử lý ngầm qua Apache Tika + pgvector *(SRS Sec 2.6.2, 6.1.4)*.
- **`410 Gone`** *(Fallback: `400 Bad Request`)*: Áp dụng cho Token lời mời Workspace hoặc Thẻ đề xuất AI đã quá hạn hiệu lực *(SRS Sec 4.3.2, 5.6.5)*.
- **`413 Payload Too Large`** *(Fallback: `400 Bad Request`)*: Áp dụng khi tệp tải lên vượt quá giới hạn dung lượng *(SRS Sec 5.5.4, 6.1.3)*.
- **`504 Gateway Timeout`** *(Fallback: `500 Internal Server Error`)*: Áp dụng khi vòng lặp suy luận hoặc gọi tool của AI Agent chạm ngưỡng trần 45 giây *(SRS Sec 5.6.4)*.

---

## 6. Tiêu đề HTTP Đặc biệt (HTTP Headers)

1. **Header Xác thực:**
   ```http
   Authorization: Bearer <access_token>
   ```
   Bắt buộc đối với toàn bộ các endpoint bảo vệ (`Auth Req: Có`) *(SRS Sec 5.5.1)*.

2. **Header Chống Xử lý Trùng lặp (Idempotency Key):**
   ```http
   Idempotency-Key: <uuid>
   ```
   - **Bắt buộc:** Áp dụng cho endpoint PM Phê duyệt đề xuất của AI (`POST /boards/:id/ai/proposals/:proposalId/decide`) theo quy định tại **SRS Sec 5.6.5 và 6.3.3**.
   - Ngăn chặn việc PM bấm Duyệt nhiều lần hoặc lỗi mạng gây nhân bản thao tác thay đổi cơ sở dữ liệu.

3. **Header Xác thực Chữ ký Webhook GitHub:**
   ```http
   X-Hub-Signature-256: sha256=<hmac_hex>
   ```
   - Bắt buộc đối với endpoint tiếp nhận Webhook từ GitHub (`POST /github/webhooks`) nhằm đối chiếu chữ ký bảo mật với Webhook Secret *(SRS Sec 4.4.3, 5.5.5)*.

---

## 7. Bảng Tổng hợp Ràng buộc Định lượng & Giới hạn Hệ thống (System Limits & Constraints)

Bảng đối chiếu toàn bộ các hằng số, ngưỡng giới hạn định lượng và quy tắc thời gian được quy định trong SRS:

| Thông số / Giới hạn | Giá trị quy định | Căn cứ nguồn SRS | Phân loại |
| :--- | :--- | :--- | :---: |
| **Thời hạn Access Token** | 15 phút | Mục 3.2.2 (Luồng chính bước 6) | `[SRS-CORE]` |
| **Thời hạn Refresh Token** | 7 ngày | Mục 3.2.2 (Luồng chính bước 6) | `[SRS-CORE]` |
| **Thời hạn Token lời mời Workspace** | 7 ngày | Mục 4.3.2 | `[SRS-CORE]` |
| **Thời hạn hiệu lực Đề xuất AI (Action Card TTL)** | 24 giờ | Mục 5.6.5 | `[SRS-CORE]` |
| **Rate Limit Đăng nhập** | Tối đa 5 lần thử sai / 1 phút / 1 IP | Mục 5.5.3 | `[SRS-CORE]` |
| **Giới hạn số Cột (Lists) trên mỗi Board** | Tối đa 30 Lists | Mục 6.1.3 | `[SRS-CORE]` |
| **Giới hạn số Thẻ (Cards) trên mỗi Board** | Tối đa 2,000 Cards | Mục 6.1.3 | `[SRS-CORE]` |
| **Giới hạn Task con (Checklist) trong Card** | Tối đa 50 mục Checklist / Card | Mục 6.1.3 | `[SRS-CORE]` |
| **Giới hạn tải tài liệu Kho tri thức (KB Document)** | Tối đa 15MB / tệp; tối đa 50 trang hoặc $\le$ 100,000 ký tự thô | Mục 5.5.4, Mục 6.1.3 | `[SRS-CORE]` |
| **Định dạng tệp Kho tri thức được hỗ trợ** | `.pdf`, `.docx`, `.txt` | Mục 2.6.3, Mục 5.5.4 | `[SRS-CORE]` |
| **Giới hạn tải ảnh đại diện / ảnh bìa** | Tối đa 5MB / tệp | Mục 5.5.4, Mục 6.1.3 | `[SRS-CORE]` |
| **Giới hạn tệp đính kèm Thẻ việc (Card Attachment)** | **25MB** (theo Mục 3.5.1) vs **5MB/15MB** (theo Mục 6.1.3) | Mục 3.5.1 (3a.3E1) & Mục 6.1.3 | **`[CONFLICT IN SOURCE]`** `[NEEDS VERIFICATION]` |
| **Số bước suy luận tối đa của AI Agent** | `maxSteps` = 5 bước / lượt yêu cầu | Mục 5.6.4 | `[SRS-CORE]` |
| **Thời gian trần Timeout của AI Agent** | Tối đa 45 giây | Mục 5.6.4 | `[SRS-CORE]` |
| **Thời gian trả về ký tự AI đầu tiên** | $\le$ 2 giây | Mục 6.1.4 | `[SRS-CORE]` |
| **Thời gian hoàn thành câu trả lời phân tích AI**| $\le$ 15 giây | Mục 6.1.4 | `[SRS-CORE]` |
| **Thời gian lập chỉ mục tài liệu (< 10MB) vào pgvector** | < 60 giây | Mục 6.1.4 | `[SRS-CORE]` |
| **Độ trễ đồng bộ WebSocket Kanban** | < 500ms | Mục 6.1.2 | `[SRS-CORE]` |
| **Độ trễ thông báo đẩy nội bộ** | $\le$ 1 giây | Mục 6.1.2 | `[SRS-CORE]` |
| **Thời gian phản hồi API CRUD cơ bản** | < 300ms (cho 95% request) | Mục 6.1.1 | `[SRS-CORE]` |
| **Thời hạn lưu trữ Nhật ký kiểm toán (Audit Log)**| Tối thiểu 90 ngày (cơ chế Append-Only) | Mục 5.4.4 | `[SRS-CORE]` |

> [!WARNING]
> **Ghi nhận `[CONFLICT IN SOURCE]` về Giới hạn tệp đính kèm Card:**
> - Tại Mục 3.5.1 (trang 57, luồng ngoại lệ 3a.3E1) ghi: *"Dung lượng tệp đính kèm tối đa là 25MB"*.
> - Tuy nhiên, tại Mục 6.1.3 (trang 83) lại ghi: *"Giới hạn tệp đính kèm: Tối đa 5MB đối với tệp hình ảnh và tối đa 15MB đối với tệp tài liệu dự án"*.
> - **Quy ước tạm thời trong hợp đồng API:** Áp dụng trần tối đa **25MB** cho Card Attachment, đồng thời gắn cờ `[NEEDS VERIFICATION]` để nhóm thống nhất với Giảng viên hướng dẫn nếu cần siết chặt xuống 15MB.

---

## 8. Kiểm soát Ghi đè Đồng thời (Optimistic Concurrency Control - OCC)

Theo quy định tại **SRS Sec 6.3.1**:
- Áp dụng cơ chế kiểm soát đồng thời lạc quan thông qua mốc thời gian `updatedAt` (hoặc trường `version`) của Thẻ việc (`Card`).
- Khi client gửi yêu cầu cập nhật chi tiết Card (`PATCH /cards/:id`), client gửi kèm trường `updatedAt` (thời điểm client nạp dữ liệu) trong Request Body.
- **Quy tắc xử lý:**
  - Nếu `updatedAt` gửi lên khớp với CSDL: Cho phép cập nhật và ghi nhận `updatedAt` mới.
  - Nếu `updatedAt` gửi lên cũ hơn CSDL (do người khác đã lưu trước): Máy chủ từ chối và phản hồi mã lỗi `409 Conflict` kèm mã lỗi `CARD_CONFLICT` *(SRS Sec 6.3.1)*.

---

## 9. Từ điển Mã Lỗi Hệ thống (Standardized Error Catalog)

Toàn bộ các mã lỗi dưới đây được ánh xạ chuẩn vào danh mục mã trạng thái HTTP chính thức của SRS Mục 4.2.2:

### 9.1. Phân hệ AUTH — Xác thực & Hồ sơ
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `INVALID_CREDENTIALS` | 401 | Email hoặc mật khẩu không chính xác. | UC-AUTH-02 (4E1) | `[SRS-CORE]` |
| `ACCOUNT_LOCKED` | 403 | Tài khoản đã bị System Admin khóa do vi phạm chính sách. | UC-AUTH-02 (5E1), Sec 2.4.10 | `[SRS-CORE]` |
| `TOKEN_EXPIRED` | 401 | Access token hoặc Refresh token đã hết thời hạn hiệu lực. | UC-AUTH-05 (2E1), UC-COL-15 (4E1) | `[SRS-CORE]` |
| `TOKEN_INVALID` | 401 | Token phiên làm việc không đúng định dạng hoặc sai chữ ký. | Sec 5.1 | `[SRS-CORE]` |
| `EMAIL_ALREADY_EXISTS` | 409 | Địa chỉ email đăng ký đã tồn tại trên hệ thống. | UC-AUTH-01 (4E1) | `[SRS-CORE]` |
| `PASSWORD_MISMATCH` | 400 | Mật khẩu xác nhận không khớp hoặc mật khẩu cũ nhập sai. | UC-AUTH-01 (3E1), UC-AUTH-05 (4b.5E1) | `[SRS-CORE]` |
| `OAUTH_AUTH_FAILED` | 401 | Xác thực qua Google hoặc GitHub OAuth thất bại. | UC-AUTH-03, UC-AUTH-04 | `[SRS-CORE]` |

### 9.2. Phân hệ WORKSPACE — Không gian làm việc
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `WORKSPACE_NOT_FOUND` | 404 | Workspace không tồn tại hoặc người dùng không có quyền truy cập. | Sec 4.2.2 | `[SRS-CORE]` |
| `WORKSPACE_FROZEN` | 403 | Workspace đang bị System Admin đóng băng (chỉ đọc). | Sec 2.4.10, UC-SYS-28 | `[SRS-CORE]` |
| `WORKSPACE_ARCHIVED` | 403 | Workspace đã bị lưu trữ, không thể chỉnh sửa dữ liệu bên trong. | Sec 2.4.7, UC-Board-09 (5E1) | `[SRS-CORE]` |
| `NOT_WORKSPACE_OWNER` | 403 | Thao tác chỉ dành riêng cho Chủ sở hữu Workspace (Owner). | UC-WS-08 (3a.3E1), Sec 2.4.2 | `[SRS-CORE]` |
| `CANNOT_REMOVE_SOLE_OWNER`| 400 | Không thể tự hạ quyền hoặc rời khỏi khi là Owner duy nhất. | UC-WS-07 (4E1) | `[SRS-CORE]` |
| `INVITATION_NOT_FOUND` | 404 | Lời mời không tồn tại hoặc đã bị hủy. | UC-WS-06 (8a.2E1) | `[SRS-CORE]` |
| `INVITATION_EXPIRED` | 400 *(410)* | Lời mời tham gia Workspace đã hết hạn (> 7 ngày). | Sec 4.3.2, UC-WS-06 (8a.2E1) | `[SRS-CORE]` |
| `ALREADY_WORKSPACE_MEMBER`| 409 | Người dùng này đã là thành viên chính thức của Workspace. | UC-WS-06 (4E1) | `[SRS-CORE]` |

### 9.3. Phân hệ BOARD — Bảng dự án
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `BOARD_NOT_FOUND` | 404 | Bảng dự án không tồn tại. | Sec 4.2.2 | `[SRS-CORE]` |
| `BOARD_ARCHIVED` | 403 | Bảng đang ở trạng thái lưu trữ (Archived), chặn mọi sửa đổi. | Sec 2.4.7, UC-Board-09 (3b.2) | `[SRS-CORE]` |
| `BOARD_NOT_ARCHIVED` | 400 | Không thể xóa vĩnh viễn Bảng đang hoạt động (phải Archive trước). | UC-Board-09 (3c.1) & Quyết định kỹ thuật | `[SRS-CORE]` |
| `NOT_BOARD_PM` | 403 | Chỉ có Project Manager (PM) của Board này mới có quyền thao tác. | UC-Board-09 (3a.3E1), Sec 2.4.2 | `[SRS-CORE]` |
| `BOARD_CONFIRMATION_NAME_MISMATCH` | 400 | Tên nhập xác nhận xóa vĩnh viễn không khớp với tên Bảng. | UC-Board-09 (3c.2) | `[SRS-CORE]` |

### 9.4. Phân hệ LIST — Cột quy trình
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `LIST_NOT_FOUND` | 404 | Cột quy trình không tồn tại. | Sec 4.2.2 | `[SRS-CORE]` |
| `INVALID_STATUS_CATEGORY` | 400 | Cột phải thuộc đúng 1 trong 3 nhóm: `TODO`, `IN_PROGRESS`, `DONE`. | Sec 2.4.5 | `[SRS-CORE]` |

### 9.5. Phân hệ CARD & PLAN — Thẻ việc, Nhiệm vụ con & Lập kế hoạch
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `CARD_NOT_FOUND` | 404 | Thẻ việc không tồn tại (Ví dụ minh họa tại Sec 4.2.2). | Sec 4.2.2, UC-COL-17 (4E1) | `[SRS-CORE]` |
| `CARD_CONFLICT` | 409 | Xung đột OCC: Dữ liệu thẻ đã bị thành viên khác sửa trước đó. | Sec 6.3.1 | `[SRS-CORE]` |
| `DEPENDENCY_UNRESOLVED` | 409 | Không thể chuyển thẻ sang Done do còn thẻ phụ thuộc chưa xong. | UC-Card-12 (3c.2E1), Sec 2.4.4 | `[SRS-CORE]` |
| `ATTACHMENT_TOO_LARGE` | 400 *(413)* | Dung lượng tệp đính kèm thẻ vượt quá giới hạn cho phép. | UC-Card-12 (3a.3E1), Sec 6.1.3 | `[SRS-CORE]` |
| `TASK_LIMIT_EXCEEDED` | 400 | Số lượng mục checklist con trong thẻ vượt quá giới hạn 50 mục. | Sec 6.1.3 | `[SRS-CORE]` |
| `INVALID_DATE_RANGE` | 400 | Ngày bắt đầu không được muộn hơn hạn chót. | Sec 2.4.9 | `[SRS-CORE]` |

### 9.6. Phân hệ KB — Kho tri thức
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `DOCUMENT_NOT_FOUND` | 404 | Tài liệu không tồn tại trong kho tri thức của Board. | Sec 4.2.2 | `[SRS-CORE]` |
| `DOCUMENT_TOO_LARGE` | 400 *(413)* | Dung lượng tài liệu vượt quá giới hạn 15MB. | Sec 5.5.4, Sec 6.1.3 | `[SRS-CORE]` |
| `DOCUMENT_UNSUPPORTED_FORMAT` | 400 | Định dạng tệp không được hỗ trợ (chỉ nhận `.pdf`, `.docx`, `.txt`). | Sec 2.6.3, Sec 5.5.4 | `[SRS-CORE]` |
| `DOCUMENT_PAGE_LIMIT_EXCEEDED`| 400 | Tài liệu vượt quá giới hạn (tối đa 50 trang hoặc 100,000 ký tự thô). | Sec 6.1.3 | `[SRS-CORE]` |
| `DOCUMENT_PROCESSING_FAILED` | 500 | Lỗi trích xuất văn bản qua Apache Tika hoặc tính vector pgvector. | Sec 2.5.3, Sec 6.2.2 | `[SRS-CORE]` |

### 9.7. Phân hệ AI — Trợ lý AI & Đề xuất
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `AI_KILL_SWITCH_ACTIVE` | 403 | Tính năng AI Agent đang bị System Admin tạm ngắt khẩn cấp. | Sec 5.6.4, UC-SYS-30 | `[SRS-CORE]` |
| `AI_QUOTA_EXCEEDED` | 429 | Workspace đã vượt quá hạn ngạch sử dụng AI hàng tháng hoặc lượt gọi. | Sec 5.5.3, Sec 6.4.2 | `[SRS-CORE]` |
| `PROPOSAL_NOT_FOUND` | 404 | Thẻ đề xuất của AI không tồn tại. | Sec 4.2.2 | `[SRS-CORE]` |
| `PROPOSAL_EXPIRED` | 400 *(410)* | Thẻ đề xuất của AI đã hết hạn hiệu lực (TTL 24 giờ). | Sec 5.6.5 | `[SRS-CORE]` |
| `PROPOSAL_ALREADY_DECIDED`| 409 | Đề xuất đã được duyệt hoặc từ chối trước đó (kiểm tra Idempotency). | Sec 5.6.5, Sec 6.3.3 | `[SRS-CORE]` |
| `AI_TIMEOUT` | 500 *(504)* | Vòng lặp suy luận hoặc gọi tool của AI vượt quá trần 45 giây. | Sec 5.6.4 | `[SRS-CORE]` |

### 9.8. Phân hệ GIT — Tích hợp GitHub (POC)
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `GITHUB_CONNECTOR_DISABLED`| 400 | Tích hợp GitHub chưa được kích hoạt cho Bảng dự án này. | Sec 4.4.5, Sec 6.2.2 | `[SRS-CORE]` |
| `INVALID_WEBHOOK_SIGNATURE`| 401 | Chữ ký xác thực Webhook `X-Hub-Signature-256` không hợp lệ. | Sec 4.4.3, Sec 5.5.5 | `[SRS-CORE]` |
| `REPO_ALREADY_CONNECTED` | 409 | Repository GitHub này đã được liên kết với một Bảng dự án khác. | Sec 4.4.1 | `[PROPOSED API DESIGN]` |

### 9.9. Phân hệ SYS — Quản trị Nền tảng
| Error Code | HTTP Status | Diễn giải nghiệp vụ | Căn cứ nguồn SRS | Phân loại |
| :--- | :---: | :--- | :--- | :---: |
| `SYS_ADMIN_REQUIRED` | 403 | Thao tác yêu cầu quyền quản trị cấp hệ thống (System Admin). | Sec 2.2.5, Sec 4.1.4 | `[SRS-CORE]` |
| `RATE_LIMIT_EXCEEDED` | 429 | Vượt ngưỡng tần suất truy cập cho phép. | Sec 5.5.3 | `[SRS-CORE]` |
