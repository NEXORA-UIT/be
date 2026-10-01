# Nexora Endpoint Matrix (Proposed API Contract)

## 1. Giới thiệu và Nguyên tắc Rà soát

### 1.1. Bản chất tài liệu
- Tài liệu này là **Hợp đồng API Đề xuất (Proposed API Contract)** nhằm cụ thể hóa toàn bộ các yêu cầu chức năng từ `Tài liệu SRS Đồ án 1.pdf` thành các điểm cuối HTTP RESTful tường minh.
- **Tính chuẩn xác của mã Use Case:** Bảng ma trận sử dụng danh mục mã Use Case chuẩn xác định nghĩa tại **Mục 3.1.3 (Danh mục UC, trang 35–39 của SRS)** từ `UC-AUTH-01` đến `UC-SYS-32`. Đồng thời, cột ghi chú có đối chiếu chéo với các mã số theo từng phân hệ trong Mục 3.7–3.11 để đảm bảo khả năng truy vết (Traceability).
- **Phân định ranh giới:**
  - `[SRS-CORE]`: Yêu cầu bắt buộc được đặc tả trực tiếp trong SRS.
  - `[PROPOSED API DESIGN]`: Đề xuất thiết kế API kỹ thuật để hiện thực hóa luồng nghiệp vụ tương ứng theo chuẩn REST.
  - `[NEEDS VERIFICATION]`: Các điểm chi tiết chưa được định lượng hoàn toàn trong tài liệu nguồn, cần trao đổi xác nhận thêm giữa 2 thành viên nếu cần tinh chỉnh.

### 1.2. Mô hình Phân quyền áp dụng (Authorization Matrix)
1. **`Public`**: Không cần token xác thực (Khách - Guest).
2. **`Authenticated`**: Người dùng đã đăng nhập hệ thống với Access Token hợp lệ.
3. **`Workspace:Owner`**: Chủ sở hữu Workspace (duy nhất 1 Owner/Workspace - người tạo ban đầu). Có toàn quyền quản trị Workspace, mời thành viên và phân công PM cho từng Board.
4. **`Board:PM`**: Trưởng dự án của Board (duy nhất 1 PM/Board). Kế thừa toàn bộ quyền của Member, chịu trách nhiệm quản lý quy trình, tài liệu, duyệt đề xuất AI và quản lý thành viên Board.
5. **`Board:Member+`**: Thành viên được thêm vào Board (bao gồm cả PM và Owner của Workspace sở hữu Board).
6. **`SystemAdmin`**: Quản trị viên cấp nền tảng. Quản lý hạn ngạch, khóa tài khoản, kích hoạt Kill-Switch, giám sát hàng đợi và kiểm toán. Không mặc định đọc nội dung các dự án.

---

## 2. Bảng Ma trận Điểm cuối (Endpoint Matrix — 16 Cột chuẩn)

### 2.1. Phân hệ AUTH — Xác thực & Tài khoản người dùng
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AUTH** | Auth | `POST` | `/auth/register` | Gửi link xác nhận đăng ký | Guest | Không | `Public` | `RegisterRequestDto` | None | None | `202 Accepted` | `400`, `409`, `503` | **UC-AUTH-01** | FR-01, SEC-01 | Lưu pending registration trong Redis 15 phút; chưa tạo User hoặc JWT; gửi link qua Gmail |
| **AUTH** | Auth | `POST` | `/auth/verify-registration` | Xác nhận email và tạo tài khoản | Guest | Không | `Public` | `{token}` | None | None | `201 Created` (Tokens) | `400`, `409` | **UC-AUTH-01** | FR-01, SEC-01 | Frontend lấy token từ link Gmail rồi gọi backend; token dùng một lần |
| **AUTH** | Auth | `POST` | `/auth/login` | Đăng nhập tài khoản | Guest | Không | `Public` | `LoginRequestDto` | None | None | `200 OK` (Tokens) | `400`, `401`, `403` | **UC-AUTH-02** | FR-01, SEC-01 | [SRS-CORE] Cặp token (Access/Refresh) trả về trong JSON body; rate limit 5 lần/phút |
| **AUTH** | Auth | `POST` | `/auth/refresh` | Làm mới Access Token | Guest/User | Không | `Public` | `RefreshTokenDto` | None | None | `200 OK` (Tokens) | `400`, `401` | **UC-AUTH-02** | FR-01, SEC-01 | [PROPOSED API DESIGN] Đổi Refresh Token lấy Access Token mới |
| **AUTH** | Auth | `POST` | `/auth/logout` | Đăng xuất phiên hiện tại | User | Có | `Authenticated` | None | None | None | `200 OK` | `401` | **UC-AUTH-02** | FR-01, SEC-01 | Thu hồi access/refresh token của phiên hiện tại |
| **AUTH** | Auth | `POST` | `/auth/logout-all` | Đăng xuất mọi thiết bị | User | Có | `Authenticated` | None | None | None | `200 OK` | `401` | **UC-AUTH-02** | FR-01, SEC-01 | Thu hồi mọi phiên của user |
| **AUTH** | Auth | `POST` | `/auth/forgot-password` | Yêu cầu đặt lại mật khẩu | Guest | Không | `Public` | `{email}` | None | None | `200 OK` | `400`, `503` | **UC-AUTH-05** | FR-01, SEC-01 | Phản hồi không tiết lộ email có tồn tại hay không; gửi link qua Gmail |
| **AUTH** | Auth | `POST` | `/auth/reset-password` | Đặt lại mật khẩu bằng token | Guest | Không | `Public` | `{token,newPassword}` | None | None | `200 OK` | `400` | **UC-AUTH-05** | FR-01, SEC-01 | Token một lần, TTL 15 phút; thu hồi mọi phiên cũ |
| **AUTH** | Auth | `POST` | `/auth/oauth/google/start` | Bắt đầu đăng nhập Google | Guest | Không | `Public` | `{redirectUri}` | None | None | `200 OK` (Authorization URL + login token) | `400`, `503` | **UC-AUTH-03** | FR-01, SEC-01 | Lưu hash login token và PKCE verifier trong Redis 10 phút; frontend giữ token thô trong `sessionStorage` |
| **AUTH** | Auth | `POST` | `/auth/oauth/google` | Hoàn tất đăng nhập Google | Guest | Không | `Public` | `{code,state,redirectUri}` | None | None | `200 OK` (Tokens) | `400`, `401`, `403`, `409` | **UC-AUTH-03** | FR-01, SEC-01 | [SRS-CORE] Kiểm tra state + PKCE; định danh bằng Google `sub`; email đã xác minh trùng user cũ thì tự liên kết |
| **AUTH** | Auth | `POST` | `/auth/oauth/github` | Đăng nhập một chạm GitHub | Guest | Không | `Public` | `OAuthExchangeDto` | None | None | `200 OK` (Tokens) | `400`, `401`, `409` | **UC-AUTH-04** | FR-01, SEC-01 | [SRS-CORE] Quyền tối thiểu (`read:user, user:email`); email trùng cần liên kết chủ động. *Lưu ý: Bảng 3.1.3 trong SRS in nhầm tiêu đề là Google OAuth* |
| **AUTH** | Profile | `GET` | `/auth/me` | Lấy hồ sơ người dùng hiện tại | User | Có | `Authenticated` | None | None | None | `200 OK` (ProfileDto)| `401` | **UC-AUTH-05** | FR-01 | [SRS-CORE] Lấy thông tin cá nhân từ Token phiên |
| **AUTH** | Profile | `PATCH` | `/auth/me` | Cập nhật thông tin hồ sơ | User | Có | `Authenticated` | `UpdateProfileDto` | None | None | `200 OK` (ProfileDto)| `400`, `401` | **UC-AUTH-05** | FR-01 | [PLANNED] Chưa triển khai trong bước JWT; avatar phải qua Cloudinary, không lưu URL tùy ý |
| **AUTH** | Profile | `POST` | `/auth/change-password` | Đổi mật khẩu tài khoản | User | Có | `Authenticated` | `ChangePasswordDto`| None | None | `200 OK` | `400`, `401` | **UC-AUTH-05** | FR-01, SEC-01 | [SRS-CORE] Kiểm tra mật khẩu cũ, băm Bcrypt mật khẩu mới |

---

### 2.2. Phân hệ WS — Không gian làm việc & Quản lý Thành viên
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **WS** | Workspace | `POST` | `/workspaces` | Khởi tạo Workspace mới | User | Có | `Authenticated` | `CreateWorkspaceDto` | None | None | `201 Created` | `400`, `401` | **UC-WS-08** | FR-01, BR-02 | [SRS-CORE] Tự động gán người tạo làm Owner duy nhất |
| **WS** | Workspace | `GET` | `/workspaces` | Lấy danh sách Workspace của tôi | User | Có | `Authenticated` | None | None | None | `200 OK` (Array) | `401` | **UC-WS-08** | FR-01 | [PROPOSED API DESIGN] Danh sách các không gian người dùng tham gia |
| **WS** | Workspace | `GET` | `/workspaces/:id` | Lấy chi tiết thông tin Workspace | Member, Owner | Có | `Workspace:Member+` | None | None | `id` (UUID) | `200 OK` | `401`, `403`, `404` | **UC-WS-08** | FR-01 | [PROPOSED API DESIGN] Thông tin kèm vai trò cá nhân trong Workspace |
| **WS** | Workspace | `PATCH` | `/workspaces/:id` | Cập nhật thông tin Workspace | Owner | Có | `Workspace:Owner` | `UpdateWorkspaceDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-WS-08** | FR-01 | [SRS-CORE] Cập nhật Tên, Mô tả, Lĩnh vực hoạt động |
| **WS** | Workspace | `PATCH` | `/workspaces/:id/archive` | Lưu trữ Workspace | Owner | Có | `Workspace:Owner` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-WS-08** | FR-01, BR-07 | [SRS-CORE] Chuyển toàn bộ Board con sang chỉ đọc |
| **WS** | Invitation | `POST` | `/workspaces/:id/invitations` | Gửi thư mời tham gia Workspace | Owner | Có | `Workspace:Owner` | `InviteMemberDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404`, `409` | **UC-WS-06** | FR-01, SEC-02 | [SRS-CORE] Tạo token mời hạn 7 ngày, gửi ngầm qua BullMQ Mailer |
| **WS** | Invitation | `POST` | `/workspaces/invitations/:token/accept` | Chấp nhận lời mời Workspace | User | Có | `Authenticated` | None | None | `token` (String) | `200 OK` | `400`, `401`, `404`, `410` | **UC-WS-06** | FR-01, SEC-02 | [SRS-CORE] Cập nhật trạng thái ACCEPTED, thêm vào WorkspaceMember |
| **WS** | Invitation | `POST` | `/workspaces/invitations/:id/resend` | Gửi lại thư mời | Owner | Có | `Workspace:Owner` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-WS-06** | FR-01 | [SRS-CORE] Cấp mới hạn dùng token và gửi lại email |
| **WS** | Member | `GET` | `/workspaces/:id/members` | Danh sách thành viên Workspace | Member, Owner | Có | `Workspace:Member+` | None | None | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-WS-07** | FR-01 | [PROPOSED API DESIGN] Xem danh sách phục vụ phân công |
| **WS** | Member | `PATCH` | `/workspaces/:id/members/:userId` | Phân quyền vai trò thành viên | Owner | Có | `Workspace:Owner` | `UpdateMemberRoleDto`| None | `id`, `userId` | `200 OK` | `400`, `403`, `404` | **UC-WS-07** | FR-01, BR-02 | [SRS-CORE] Thiết lập vai trò nội bộ theo RBAC |
| **WS** | Member | `DELETE` | `/workspaces/:id/members/:userId` | Xóa thành viên khỏi Workspace | Owner | Có | `Workspace:Owner` | None | None | `id`, `userId` | `200 OK` | `400`, `403`, `404` | **UC-WS-07** | FR-01, BR-06 | [SRS-CORE] Chặn xóa Owner duy nhất; thu hồi quyền mọi Board trực thuộc |

---

### 2.3. Phân hệ BOARD — Quản lý Bảng dự án & Cột quy trình (List)
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BOARD** | Board | `POST` | `/workspaces/:id/boards` | Tạo Board mới thuộc Workspace | Owner | Có | `Workspace:Owner` | `CreateBoardDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-Board-09** | FR-02, BR-01 | [SRS-CORE] Gán 01 PM cho Board; tự sinh 3 cột mặc định: To Do, In Progress, Done |
| **BOARD** | Board | `GET` | `/workspaces/:id/boards` | Danh sách Board trong Workspace | Member, Owner | Có | `Workspace:Member+` | None | `includeArchived?` | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-Board-09** | FR-02 | [PROPOSED API DESIGN] Chỉ hiển thị các Board mà người dùng được tham gia |
| **BOARD** | Board | `GET` | `/boards/:id` | Lấy chi tiết thông tin Board | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-Board-09** | FR-02 | [PROPOSED API DESIGN] Snapshot cấu trúc Bảng, cài đặt và quyền |
| **BOARD** | Board | `PATCH` | `/boards/:id` | Cập nhật nhận diện của Board | PM, Owner | Có | `Board:PM` / `WS:Owner` | `UpdateBoardDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-Board-09** | FR-02 | [SRS-CORE] Sửa tên, mô tả, màu sắc/ảnh bìa nhận diện |
| **BOARD** | Board | `PATCH` | `/boards/:id/archive` | Lưu trữ Bảng (Archive) | PM, Owner | Có | `Board:PM` / `WS:Owner` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-Board-09** | FR-02, BR-07 | [SRS-CORE] Đưa vào mục đã lưu trữ, chuyển sang chỉ đọc |
| **BOARD** | Board | `PATCH` | `/boards/:id/unarchive` | Khôi phục Bảng đã lưu trữ | PM, Owner | Có | `Board:PM` / `WS:Owner` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-Board-09** | FR-02, BR-07 | [SRS-CORE] Đưa Bảng trở lại danh sách hoạt động |
| **BOARD** | Board | `DELETE` | `/boards/:id` | Xóa vĩnh viễn Bảng | PM, Owner | Có | `Board:PM` / `WS:Owner` | `ConfirmDeleteBoardDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404`, `409` | **UC-Board-09** | FR-02, BR-07 | [SRS-CORE] **Chỉ xóa khi đã Archive**; nhập lại tên Board; dọn sạch tệp trên R2 |
| **BOARD** | Board | `PATCH` | `/boards/:id/pm` | Phân công / Đổi PM của Board | Owner | Có | `Workspace:Owner` | `AssignBoardPmDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-Board-09** | FR-02, BR-02 | [SRS-CORE] Thay đổi nguyên tử: Board luôn có đúng 1 PM (Sec 2.4.2) |
| **BOARD** | Member | `GET` | `/boards/:id/members` | Danh sách thành viên của Board | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-Board-09** | FR-02 | [PROPOSED API DESIGN] Phục vụ danh sách gán việc (Assignee) |
| **BOARD** | Member | `POST` | `/boards/:id/members` | Thêm thành viên vào Board | PM | Có | `Board:PM` | `AddBoardMemberDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-Board-09** | FR-02, BR-01 | [SRS-CORE] Thành viên phải thuộc Workspace sở hữu Board |
| **BOARD** | Member | `DELETE` | `/boards/:id/members/:userId`| Xóa thành viên khỏi Board | PM | Có | `Board:PM` | None | None | `id`, `userId` | `200 OK` | `400`, `403`, `404` | **UC-Board-09** | FR-02, BR-06 | [SRS-CORE] Thu hồi quyền, gỡ toàn bộ Card phân công của người đó |
| **BOARD** | Label | `GET` | `/boards/:id/labels` | Danh sách Nhãn phân loại của Board | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-Card-12** | FR-02 | [PROPOSED API DESIGN] Nhãn thuộc phạm vi độc lập theo Board |
| **BOARD** | Label | `POST` | `/boards/:id/labels` | Tạo Nhãn mới trên Board | Member, PM | Có | `Board:Member+` | `CreateLabelDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-Card-12** | FR-02 | [PROPOSED API DESIGN] Tên nhãn, dải màu sắc phân loại |
| **LIST** | List | `POST` | `/boards/:id/lists` | Thêm Cột trạng thái mới | PM | Có | `Board:PM` | `CreateListDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-List-10** | FR-02, BR-05 | [SRS-CORE] Phải thuộc 1 trong 3 nhóm: `TODO`, `IN_PROGRESS`, `DONE` |
| **LIST** | List | `GET` | `/boards/:id/lists` | Lấy danh sách Cột kèm Thẻ việc | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-List-10** | FR-02 | [PROPOSED API DESIGN] Dữ liệu hiển thị Kanban Board hoàn chỉnh |
| **LIST** | List | `PATCH` | `/lists/:id` | Đổi tên hoặc nhóm trạng thái Cột | PM | Có | `Board:PM` | `UpdateListDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-List-10** | FR-02 | [SRS-CORE] Đổi tên cột, cập nhật nhóm quy trình |
| **LIST** | List | `PATCH` | `/lists/:id/position` | Sắp xếp lại thứ tự Cột | PM | Có | `Board:PM` | `ReorderListDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-List-10** | FR-02 | [SRS-CORE] Cập nhật chỉ số vị trí position; phát sự kiện WebSocket |
| **LIST** | List | `PATCH` | `/lists/:id/archive` | Lưu trữ hoặc Xóa Cột trạng thái | PM | Có | `Board:PM` | `ArchiveListDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-List-10** | FR-02 | [SRS-CORE] Tùy chọn lưu trữ cả thẻ hoặc di chuyển thẻ sang cột khác |

---

### 2.4. Phân hệ CARD & PLAN — Quản lý Công việc, Phụ thuộc & Lập kế hoạch
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CARD** | Card | `POST` | `/lists/:id/cards` | Khởi tạo Thẻ việc mới | Member, PM | Có | `Board:Member+` | `CreateCardDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-Card-12** | FR-02, BR-04 | [SRS-CORE] Tự động ghi ActivityLog, phát sóng WebSocket |
| **CARD** | Card | `GET` | `/cards/:id` | Lấy chi tiết toàn diện của Card | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (CardDto) | `403`, `404` | **UC-Card-12** | FR-02 | [SRS-CORE] Mô tả Markdown, Tasks, Assignees, Labels, Dates, Files |
| **CARD** | Card | `PATCH` | `/cards/:id` | Cập nhật thông tin chi tiết Card | Member, PM | Có | `Board:Member+` | `UpdateCardDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404`, `409` | **UC-Card-12** | FR-02, SEC-02 | [SRS-CORE] **Kiểm tra OCC (updatedAt)**; ngày bắt đầu $\le$ hạn chót |
| **CARD** | Card | `PATCH` | `/cards/:id/move` | Kéo thả di chuyển Thẻ | Member, PM | Có | `Board:Member+` | `MoveCardDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404`, `409` | **UC-Card-12** | FR-02, BR-05 | [SRS-CORE] **Kiểm tra Dependency trước khi thả vào Done**; chạy DB transaction |
| **CARD** | Card | `PATCH` | `/cards/:id/archive` | Lưu trữ Thẻ việc | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-Card-12** | FR-02, BR-07 | [SRS-CORE] Đưa ra khỏi bảng Kanban, giữ nguyên dữ liệu |
| **CARD** | Card | `DELETE` | `/cards/:id` | Xóa mềm Thẻ việc | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-Card-12** | FR-02 | [SRS-CORE] Xóa mềm bản ghi trong CSDL; phát sự kiện gỡ thẻ |
| **CARD** | Task | `POST` | `/cards/:id/tasks` | Thêm mục công việc con (Task) | Member, PM | Có | `Board:Member+` | `CreateTaskDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-Card-12** | FR-02 | [SRS-CORE] Checklist con trong thẻ, tối đa 50 mục/Card |
| **CARD** | Task | `PATCH` | `/tasks/:id` | Đánh dấu hoàn thành / Sửa Task | Member, PM | Có | `Board:Member+` | `UpdateTaskDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-Card-12** | FR-02 | [SRS-CORE] Cập nhật isCompleted; tính lại % tiến độ của Card |
| **CARD** | Task | `DELETE` | `/tasks/:id` | Xóa mục công việc con | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-Card-12** | FR-02 | [PROPOSED API DESIGN] Xóa checklist item |
| **CARD** | Attachment | `POST` | `/cards/:id/attachments` | Đính kèm tệp vào Thẻ việc | Member, PM | Có | `Board:Member+` | `multipart/form-data` | None | `id` (UUID) | `201 Created` | `400`, `403`, `413` | **UC-Card-12** | FR-02, NFR-03 | [SRS-CORE] Tối đa 25MB/tệp; **không tự động đưa vào Knowledge Base** |
| **CARD** | Attachment | `DELETE` | `/cards/:id/attachments/:attachmentId` | Xóa tệp đính kèm Thẻ | Member, PM | Có | `Board:Member+` | None | None | `id`, `attachmentId` | `200 OK` | `403`, `404` | **UC-Card-12** | FR-02 | [SRS-CORE] Xóa bản ghi và xóa tệp lưu trên Cloudflare R2 |
| **CARD** | Search | `GET` | `/boards/:id/cards/search` | Tìm kiếm & Lọc thẻ nâng cao | Member, PM | Có | `Board:Member+` | None | `q, status, assigneeId, labelId, due` | `id` (UUID) | `200 OK` (Array) | `400`, `403`, `404` | **UC-Card-13** | FR-02 | [SRS-CORE] Lọc đa chiều theo từ khóa, người làm, nhãn, hạn chót |
| **PLAN** | Dependency | `POST` | `/cards/:id/dependencies` | Khai báo quan hệ phụ thuộc | PM | Có | `Board:PM` | `CreateDependencyDto`| None | `id` (UUID) | `201 Created` | `400`, `403`, `404`, `409` | **UC-PLAN-11** | FR-04, BR-04 | [SRS-CORE] Chặn tạo phụ thuộc vòng (Circular dependency) |
| **PLAN** | Dependency | `DELETE` | `/cards/:id/dependencies/:dependencyId` | Hủy bỏ quan hệ phụ thuộc | PM | Có | `Board:PM` | None | None | `id`, `dependencyId` | `200 OK` | `403`, `404` | **UC-PLAN-11** | FR-04 | [SRS-CORE] Gỡ bỏ ràng buộc giữa 2 Card |
| **PLAN** | Calendar | `GET` | `/boards/:id/calendar` | Lấy dữ liệu công việc theo Lịch | Member, PM | Có | `Board:Member+` | None | `start, end` (ISO) | `id` (UUID) | `200 OK` (Array) | `400`, `403`, `404` | **UC-PLAN-14** | FR-04 | [SRS-CORE] Chuẩn định dạng mốc thời gian cho FullCalendar |
| **PLAN** | Dashboard | `GET` | `/boards/:id/dashboard` | Xem thống kê tiến độ Board | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (DashboardDto)| `403`, `404` | **UC-PLAN-23** | FR-04 | [PROPOSED API DESIGN] Thống kê tỷ lệ hoàn thành, quá hạn, tồn đọng (hỗ trợ UC-PLAN-23 và phạm vi mở rộng Dashboard Sec 3.7.4) |

---

### 2.5. Phân hệ COL — Cộng tác, Hoạt động, Thông báo & Ghi chú cá nhân
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **COL** | Realtime | `WS` | `/realtime (ws)` | Kết nối kênh WebSocket | Member, PM | Có | `Board:Member+` | WS Handshake | `boardId` | None | `101 Switching` | `401`, `403` | **UC-COL-15** | FR-03, NFR-02 | [SRS-CORE] Phòng `board:{board_id}`; đồng bộ tức thì kéo thả thẻ |
| **COL** | Comment | `POST` | `/cards/:id/comments` | Đăng bình luận trong Card | Member, PM | Có | `Board:Member+` | `CreateCommentDto` | None | `id` (UUID) | `201 Created` | `400`, `403`, `404` | **UC-COL-16** | FR-03 | [SRS-CORE] Hỗ trợ Markdown, quét `@mention` gửi mail qua BullMQ |
| **COL** | Comment | `GET` | `/cards/:id/comments` | Danh sách bình luận của Card | Member, PM | Có | `Board:Member+` | None | `page, limit` | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-COL-16** | FR-03 | [PROPOSED API DESIGN] Phục vụ hiển thị dòng thời gian thảo luận |
| **COL** | Comment | `PATCH` | `/comments/:id` | Chỉnh sửa nội dung bình luận | Author | Có | `Resource:Owner` | `UpdateCommentDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-COL-16** | FR-03 | [SRS-CORE] Chỉ tác giả mới được quyền sửa bình luận của mình |
| **COL** | Comment | `DELETE` | `/comments/:id` | Xóa bình luận | Author, PM | Có | `Author` / `Board:PM` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-COL-16** | FR-03 | [SRS-CORE] Tác giả hoặc PM xóa; phát sự kiện ẩn bình luận |
| **COL** | Activity | `GET` | `/cards/:id/activities` | Lấy lịch sử biến động của Card | Member, PM | Có | `Board:Member+` | None | `page=1, limit=20` | `id` (UUID) | `200 OK` (Paginated) | `403`, `404` | **UC-COL-17** | FR-03 | [SRS-CORE] Phân trang mặc định 20 bản ghi; sắp xếp mới nhất lên đầu |
| **COL** | Notification | `GET` | `/users/me/notifications` | Lấy danh sách thông báo cá nhân | User | Có | `Authenticated` | None | `page, limit, unreadOnly` | None | `200 OK` (Paginated) | `401` | **UC-COL-18** | FR-03 | [SRS-CORE] Thông báo giao việc, nhắc hạn, nhắc tên |
| **COL** | Notification | `PATCH` | `/users/me/notifications/:id/read` | Đánh dấu thông báo đã đọc | User | Có | `Authenticated` | None | None | `id` (UUID) | `200 OK` | `401`, `404` | **UC-COL-18** | FR-03 | [SRS-CORE] Cập nhật isRead = true, giảm huy hiệu đỏ |
| **COL** | Notification | `PATCH` | `/users/me/notifications/read-all`| Đánh dấu tất cả thông báo đã đọc | User | Có | `Authenticated` | None | None | None | `200 OK` | `401` | **UC-COL-18** | FR-03 | [SRS-CORE] Cập nhật hàng loạt isRead = true |
| **COL** | Notification | `DELETE` | `/users/me/notifications/:id` | Xóa bản ghi thông báo | User | Có | `Authenticated` | None | None | `id` (UUID) | `200 OK` | `401`, `404` | **UC-COL-18** | FR-03 | [SRS-CORE] Xóa thông báo khỏi danh sách |
| **COL** | QuickNote | `GET` | `/users/me/quick-notes` | Lấy danh sách ghi chú cá nhân | User | Có | `Authenticated` | None | None | None | `200 OK` (Array) | `401` | **UC-PLAN-19** | FR-03 | [SRS-CORE] Không gian ghi chú cá nhân độc lập với dự án |
| **COL** | QuickNote | `POST` | `/users/me/quick-notes` | Tạo ghi chú cá nhân mới | User | Có | `Authenticated` | `CreateQuickNoteDto`| None | None | `201 Created` | `400`, `401` | **UC-PLAN-19** | FR-03 | [SRS-CORE] Soạn thảo ý tưởng nhanh dạng Quick Note |
| **COL** | QuickNote | `PATCH` | `/users/me/quick-notes/:id` | Sửa nội dung ghi chú | User | Có | `Authenticated` | `UpdateQuickNoteDto`| None | `id` (UUID) | `200 OK` | `400`, `401`, `404` | **UC-PLAN-19** | FR-03 | [SRS-CORE] Tự động lưu cập nhật văn bản |
| **COL** | QuickNote | `DELETE` | `/users/me/quick-notes/:id` | Xóa mẩu ghi chú cá nhân | User | Có | `Authenticated` | None | None | `id` (UUID) | `200 OK` | `401`, `404` | **UC-PLAN-19** | FR-03 | [SRS-CORE] Xóa vĩnh viễn ghi chú |
| **COL** | QuickNote | `POST` | `/users/me/quick-notes/:id/convert-to-card` | **Chuyển đổi Quick Note thành Card** | User | Có | `Board:Member+` | `ConvertNoteToCardDto` | None | `id` (UUID) | `201 Created` | `400`, `401`, `403`, `404` | **UC-PLAN-19** | FR-03 | [SRS-CORE] Kéo/chuyển note vào Board/List chỉ định; phát WebSocket |

---

### 2.6. Phân hệ KB — Kho tri thức & Truy vấn Tài liệu RAG
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **KB** | Document | `POST` | `/boards/:id/documents` | Tải tài liệu lên Kho tri thức | PM, Member | Có | `Board:PM` (hoặc policy) | `multipart/form-data` | None | `id` (UUID) | `202 Accepted` | `400`, `403`, `413` | **UC-KB-20** | FR-05, SEC-04 | [SRS-CORE] Max 15MB, max 50 trang; đẩy BullMQ bóc tách Tika + nhúng pgvector |
| **KB** | Document | `GET` | `/boards/:id/documents` | Danh mục tài liệu của Board | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-KB-20** | FR-05 | [SRS-CORE] Hiển thị trạng thái xử lý: PENDING, PROCESSING, READY, FAILED |
| **KB** | Document | `GET` | `/documents/:id/download` | Tải xuống tệp tài liệu gốc | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `302 Found` (URL) | `403`, `404` | **UC-KB-20** | FR-05 | [PROPOSED API DESIGN] Ký URL tải tệp bảo mật từ Cloudflare R2 |
| **KB** | Document | `DELETE` | `/documents/:id` | Xóa tài liệu khỏi Kho tri thức | PM | Có | `Board:PM` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-KB-20** | FR-05, BR-08 | [SRS-CORE] Dọn tệp trên R2; **xóa triệt để toàn bộ Chunks và Vector trong pgvector** |
| **KB** | RAG | `POST` | `/boards/:id/rag/query` | Hỏi đáp tài liệu có căn cứ | Member, PM | Có | `Board:Member+` | `RAGQueryDto` | None | `id` (UUID) | `200 OK` (RAGAnswerDto)| `400`, `403`, `404`, `429` | **UC-KB-21** | FR-05, SEC-06 | [SRS-CORE] Semantic search chỉ trong `board_id`; trích dẫn tên tệp & số trang |

---

### 2.7. Phân hệ AI — Trợ lý AI, Công cụ & Phê duyệt Hành động
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AI** | Chat | `POST` | `/boards/:id/ai/conversations` | Gửi tin nhắn hội thoại với AI | Member, PM | Có | `Board:Member+` | `AIChatMessageDto` | None | `id` (UUID) | `200 OK` (Stream/JSON) | `400`, `403`, `404`, `429` | **UC-AI-22** | FR-06, SEC-06 | [SRS-CORE] Gắn ngữ cảnh Board; AI gọi Tool nội bộ (`getCards`, `searchDocuments`) |
| **AI** | Chat | `GET` | `/boards/:id/ai/conversations/:conversationId` | Xem lịch sử hội thoại AI | Member, PM | Có | `Board:Member+` | None | None | `id`, `conversationId` | `200 OK` | `403`, `404` | **UC-AI-22** | FR-06 | [PROPOSED API DESIGN] Lấy danh sách tin nhắn và trích dẫn trong phiên chat |
| **AI** | Report | `POST` | `/boards/:id/ai/summarize-progress` | Yêu cầu AI tổng hợp tiến độ | Member, PM | Có | `Board:Member+` | `SummarizeRequestDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-PLAN-23** | FR-04, FR-06 | [SRS-CORE] Quét thẻ chậm hạn, việc tồn đọng để trích xuất báo cáo |
| **AI** | Proposal | `GET` | `/boards/:id/ai/proposals` | Danh sách Đề xuất chờ duyệt | PM | Có | `Board:PM` | None | `status?` | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-AI-24** | FR-06 | [PROPOSED API DESIGN] Xem các Action Cards do AI khởi tạo (TTL 24h) |
| **AI** | Decision | `POST` | `/boards/:id/ai/proposals/:proposalId/decide` | **Duyệt hoặc Từ chối đề xuất của AI** | PM | Có | `Board:PM` | `ProposalDecisionDto` | None | `id`, `proposalId` | `200 OK` | `400`, `403`, `404`, `409` | **UC-AI-25** | FR-06, SEC-06 | [SRS-CORE] **Human-in-the-loop**; **Bắt buộc Header `Idempotency-Key`**; kiểm tra OCC trước khi ghi DB |

---

### 2.8. Phân hệ GIT — Kết nối GitHub (Tùy chọn POC)
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GIT** | Config | `POST` | `/boards/:id/github/config` | Thiết lập liên kết GitHub Repo | PM | Có | `Board:PM` | `GitHubConfigDto` | None | `id` (UUID) | `200 OK` | `400`, `403`, `404` | **UC-GIT-26** | FR-07, SEC-05 | [SRS-CORE] Lưu trữ Webhook Secret được mã hóa trong DB |
| **GIT** | Config | `GET` | `/boards/:id/github/config` | Xem thông tin cấu hình GitHub | PM | Có | `Board:PM` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-GIT-26** | FR-07 | [PROPOSED API DESIGN] Không bao giờ trả về chuỗi Secret thô |
| **GIT** | Config | `DELETE` | `/boards/:id/github/config` | Hủy kết nối GitHub Repo | PM | Có | `Board:PM` | None | None | `id` (UUID) | `200 OK` | `403`, `404` | **UC-GIT-26** | FR-07 | [SRS-CORE] Ngắt liên kết repository khỏi Board |
| **GIT** | Webhook | `POST` | `/github/webhooks` | Tiếp nhận Webhook Push / PR | GitHub Platform | Không | `X-Hub-Signature-256` | Raw JSON Payload | None | None | `200 OK` | `400`, `401` | **UC-GIT-27** | FR-07, SEC-05 | [SRS-CORE] Bắt commit/PR có mã Card để đính kèm link vào thẻ việc |
| **GIT** | CardGit | `GET` | `/cards/:id/git-activity` | Xem Commits/PRs liên kết | Member, PM | Có | `Board:Member+` | None | None | `id` (UUID) | `200 OK` (Array) | `403`, `404` | **UC-GIT-27** | FR-07 | [PROPOSED API DESIGN] Hiển thị tiến độ kỹ thuật gắn với Card |

---

### 2.9. Phân hệ SYS — Quản trị Nền tảng & Vận hành Hệ thống
| Module | Resource | Method | Endpoint | Operation | Actor / Role | Auth Req. | Permission / Guard | Request Body | Query Params | Path Params | Success Resp. | Error Responses | Related UC (3.1.3) | Related Req. | Notes / Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SYS** | User | `GET` | `/system-admin/users` | Danh sách người dùng hệ thống | SysAdmin | Có | `SystemAdmin` | None | `page, limit, q, status` | None | `200 OK` (Paginated) | `401`, `403` | **UC-SYS-28** | FR-08 | [SRS-CORE] Giám sát tài khoản người dùng toàn hệ thống |
| **SYS** | User | `PATCH` | `/system-admin/users/:userId/status` | Khóa hoặc Mở khóa tài khoản | SysAdmin | Có | `SystemAdmin` | `UpdateUserStatusDto` | None | `userId` (UUID) | `200 OK` | `400`, `401`, `403`, `404` | **UC-SYS-28** | FR-08, SEC-03 | [SRS-CORE] Chặn truy cập và thu hồi phiên đăng nhập ngay lập tức |
| **SYS** | Workspace | `GET` | `/system-admin/workspaces` | Danh sách Workspace toàn hệ thống | SysAdmin | Có | `SystemAdmin` | None | `page, limit, q, status` | None | `200 OK` (Paginated) | `401`, `403` | **UC-SYS-28** | FR-08 | [SRS-CORE] Giám sát trạng thái hoạt động của các không gian |
| **SYS** | Workspace | `PATCH` | `/system-admin/workspaces/:id/freeze` | Đóng băng hoặc Gỡ đóng băng | SysAdmin | Có | `SystemAdmin` | `FreezeWorkspaceDto` | None | `id` (UUID) | `200 OK` | `400`, `401`, `403`, `404` | **UC-SYS-28** | FR-08, SEC-03 | [SRS-CORE] Chuyển Workspace về chỉ đọc hoặc phục hồi hoạt động |
| **SYS** | Quota | `GET` | `/system-admin/workspaces/:id/quotas`| Xem hạn ngạch tài nguyên | SysAdmin | Có | `SystemAdmin` | None | None | `id` (UUID) | `200 OK` (QuotaDto) | `401`, `403`, `404` | **UC-SYS-29** | FR-08 | [SRS-CORE] Trần Token, lượt gọi Agent, dung lượng lưu trữ |
| **SYS** | Quota | `PUT` | `/system-admin/workspaces/:id/quotas`| Cấu hình Hạn ngạch AI Quota | SysAdmin | Có | `SystemAdmin` | `UpdateQuotaDto` | None | `id` (UUID) | `200 OK` (QuotaDto) | `400`, `401`, `403`, `404` | **UC-SYS-29** | FR-08, SEC-06 | [SRS-CORE] Phân bổ hạn ngạch cho từng Workspace cụ thể |
| **SYS** | KillSwitch| `GET` | `/system-admin/ai/kill-switch` | Xem trạng thái Công tắc khẩn cấp | SysAdmin | Có | `SystemAdmin` | None | None | None | `200 OK` | `401`, `403` | **UC-SYS-30** | FR-08, SEC-06 | [PROPOSED API DESIGN] Kiểm tra AI có đang bị ngắt hay không |
| **SYS** | KillSwitch| `POST` | `/system-admin/ai/kill-switch` | Kích hoạt Công tắc khẩn cấp | SysAdmin | Có | `SystemAdmin` | `KillSwitchDto` | None | None | `200 OK` | `400`, `401`, `403` | **UC-SYS-30** | FR-08, SEC-06 | [SRS-CORE] Vô hiệu hóa ngay lập tức mọi luồng gọi LLM API |
| **SYS** | Queue | `GET` | `/system-admin/queues` | Giám sát hàng đợi nền BullMQ | SysAdmin | Có | `SystemAdmin` | None | None | None | `200 OK` (Array) | `401`, `403` | **UC-SYS-31** | FR-08 | [SRS-CORE] Xem số lượng job đang chờ, đang chạy, lỗi |
| **SYS** | Queue | `POST` | `/system-admin/queues/:queueName/retry-failed` | Tái thực thi các job lỗi | SysAdmin | Có | `SystemAdmin` | None | None | `queueName` | `200 OK` | `401`, `403`, `404` | **UC-SYS-31** | FR-08, NFR-05 | [SRS-CORE] Thử lại các job trong Dead Letter Queue |
| **SYS** | Audit | `GET` | `/system-admin/audit-logs` | Tra cứu Nhật ký kiểm toán hệ thống | SysAdmin | Có | `SystemAdmin` | None | `page, limit, eventType, from, to` | None | `200 OK` (Paginated) | `401`, `403` | **UC-SYS-32** | FR-08, SEC-03 | [SRS-CORE] Log Append-Only lưu tối thiểu 90 ngày; che dữ liệu nhạy cảm |

---

## 3. Danh mục các điểm cần lưu ý xác minh [NEEDS VERIFICATION]
1. `GET /boards/:id/labels` và `POST /boards/:id/labels`: SRS định nghĩa Label gắn với Board và Card (Sec 2.5.1), nhưng chưa đặc tả chi tiết màn hình quản lý bảng màu của Label. Đã đề xuất 2 endpoint CRUD cơ bản.
2. `POST /boards/:id/ai/conversations`: SRS yêu cầu thời gian trả ký tự đầu dưới 2s (Sec 6.1.4). Khi tích hợp UI, đề xuất sử dụng Server-Sent Events (SSE) hoặc JSON response chuẩn tùy theo thống nhất giao diện chat của Frontend.
3. Không tự tiện sinh thêm các công cụ AI vượt ngoài 7 công cụ cơ bản được SRS đề cập (`getProject`, `getTasks`, `getMilestones`, `getProjectProgress`, `searchDocuments`, `getRisks`, `suggestTasks`).
