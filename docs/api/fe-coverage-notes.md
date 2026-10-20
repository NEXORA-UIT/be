# Ghi chú luồng Settings và độ phủ API trên giao diện

Tài liệu này đối chiếu route BE hiện có với các thao tác đang có trên FE. `Có` nghĩa là đã có màn hình hoặc hành động giao diện gọi API; API client đơn thuần chưa được tính là giao diện.

## Workspace Settings

Tab **Settings** trong trang Workspace cập nhật thông tin Workspace, không phải cài đặt tài khoản cá nhân.

1. FE đọc Workspace bằng `GET /api/v1/workspaces/:id` và tải thành viên bằng `GET /api/v1/workspaces/:id/members` để xác định quyền Owner.
2. Chỉ Owner của Workspace đang hoạt động và chưa bị đóng băng mới được sửa tên, mô tả, loại Workspace. Member chỉ xem được form ở trạng thái khóa.
3. Khi lưu, FE chỉ gửi các trường đã đổi qua `PATCH /api/v1/workspaces/:id`. Body là object partial, gồm `name`, `description`, `domainCategory`; body rỗng bị từ chối.
4. BE xác thực người dùng, kiểm tra Owner và trạng thái Workspace trong transaction rồi trả Workspace vừa cập nhật. Các lỗi validation, không đủ quyền, archived hoặc frozen được trả theo error envelope hiện có.

Global **Settings** là luồng riêng: `GET/PATCH /api/v1/auth/me` cho hồ sơ và `POST /api/v1/auth/change-password` cho đổi mật khẩu. FE hiện có form hồ sơ và đổi mật khẩu.

## API BE có nhưng FE chưa đưa thành thao tác

| Nhóm | Endpoint | Tình trạng FE |
| --- | --- | --- |
| Thông báo | `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count` | Chưa có API client hoặc Notification Center trên giao diện. Nút thông báo cũng chưa được đặt trên Topbar. |
| Thông báo | `PATCH /api/v1/notifications/read-all`, `PATCH /api/v1/notifications/:id/read`, `DELETE /api/v1/notifications/:id` | BE có đánh dấu đã đọc/xóa; chưa có giao diện để thao tác. |
| Phiên đăng nhập | `POST /api/v1/auth/logout-all` | FE có hàm API nhưng không có nút/luồng để người dùng thu hồi toàn bộ phiên đăng nhập. |
| Board read model | `GET /api/v1/boards/:boardId/list-view` | BE có read model dạng danh sách; FE chưa có màn hình List View riêng. |

## Phân biệt với phần chưa có API BE

- Knowledge Base trên FE hiện dùng bài mẫu tĩnh, có nhãn “Demo content”; `src/modules/knowledge-base/routes/index.ts` chưa khai báo endpoint.
- GitHub Config trên FE đang gọi `/api/v1/boards/:boardId/github/config`, nhưng `src/modules/github/routes/index.ts` hiện chưa khai báo route. Luồng này chưa thể xem là tích hợp chạy được với BE.
- `src/modules/system-admin/routes` hiện là router rỗng; chưa có API quản trị hệ thống để FE tích hợp.

## Nguồn đối chiếu

- Workspace: `src/modules/workspaces/routes/index.ts`, `src/modules/workspaces/dto/workspace.schema.ts`, `src/modules/workspaces/services/workspace.service.ts`.
- Auth: `src/modules/auth/routes/index.ts`.
- Notifications: `src/modules/notifications/routes/index.ts`.
- Board read models: `src/modules/planning/read-models/read-model.routes.ts`.
- FE Workspace Settings: `frontend/src/components/workspace/WorkspaceSettingsPanel.tsx`.
