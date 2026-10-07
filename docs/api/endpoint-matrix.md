# Core REST endpoint matrix

Ngày rà soát: **2026-10-08**. Tài liệu này là bản đồ truy vết ngắn giữa REST Core đã triển khai và use case trong SRS. Modular OpenAPI tại `openapi/` là nguồn sự thật cho schema, request/response, error code và `operationId`; bảng dưới đây chỉ tóm tắt phạm vi và quyền.

## Quy tắc quyền áp dụng

- Workspace có đúng một Owner; người tạo mặc định là Owner. Owner quản lý Workspace và truy cập mọi Board thuộc Workspace.
- Mỗi Board có đúng một PM do Workspace Owner phân công. Owner và PM của Board là hai vai trò riêng; chuyển Owner không tự chuyển PM.
- Member chỉ được đọc và thao tác trên Board mà họ có membership. System Admin không mặc nhiên được đọc nội dung dự án.
- Backend kiểm tra quyền lồng nhau trên mọi route. Assignee không có độc quyền sửa Card; Task hoàn thành không tự đổi Card sang Done.

## REST Core

| Phân hệ | Routes | SRS | Hành vi và trạng thái |
| --- | --- | --- | --- |
| Workspace, members, invitations | `/workspaces`; `/workspaces/{id}`; `/workspaces/{id}/archive`; `/workspaces/{id}/unarchive`; `/workspaces/{id}/members`; `/workspaces/{id}/members/{userId}`; `/workspaces/{id}/leave`; `/workspaces/{id}/invitations`; `/workspaces/invitations/{token}/accept`; `/workspaces/invitations/{token}/reject`; `/workspaces/invitations/{id}/resend` | UC-WS-06/07/08 | Đã triển khai. Chuyển Workspace Owner dùng `PATCH /workspaces/{id}/members/{userId}` riêng với `PATCH /boards/{id}/pm`; khi member rời/xóa, thu hồi membership và assignment nhưng giữ nội dung/lịch sử. |
| Board, PM, Board members | `/workspaces/{id}/boards`; `/boards/{id}`; `/boards/{id}/pm`; `/boards/{id}/members`; `/boards/{id}/members/{userId}`; `/boards/{id}/archive`; `/boards/{id}/unarchive`; `DELETE /boards/{id}` | UC-Board-09 | Đã triển khai. Tạo Board, PM mặc định/phân công và ba List mặc định trong cùng transaction. Xóa vĩnh viễn chỉ Owner, chỉ Board đã archive và cần xác nhận đúng tên. |
| List | `/boards/{id}/lists`; `/lists/{id}`; `/lists/{id}/position`; `/lists/{id}/archive`; `/lists/{id}/restore` | UC-List-10 | Đã triển khai. Card status suy ra từ `List.statusGroup`; move/reorder và archive xử lý nguyên tử. |
| Card Core | `/lists/{listId}/cards`; `/boards/{boardId}/cards`; `/cards/{id}`; `/cards/{id}/move`; `/cards/{id}/archive`; `/cards/{id}/restore` | UC-Card-12/13 | Đã triển khai. Ghi có OCC; status theo List; dependency chặn chuyển sang Done; archive giữ dữ liệu và restore kiểm tra trạng thái cha. `DELETE /cards/{id}` là soft-delete, giữ child resources và history. |
| Card child resources | `/cards/{id}/tasks`; `/tasks/{id}`; `/cards/{cardId}/assignments`; `/boards/{boardId}/labels`; `/labels/{labelId}`; `/cards/{cardId}/labels` | UC-Card-12 | Đã triển khai. Assignee phải có quyền Board; Label thuộc cùng Board; tối đa 50 Tasks/Card; hoàn tất Task không tự chuyển Card sang Done. |
| Comments, attachments, activity | `/cards/{id}/comments`; `/comments/{id}`; `/cards/{id}/attachments`; `/attachments/{attachmentId}/content`; `/attachments/{attachmentId}`; `/cards/{id}/activity` | UC-COL-16/17, UC-Card-12 | Đã triển khai. Comment và Activity giữ lịch sử; Attachment là tệp của Card, không tự đưa vào Knowledge Base. Cleanup object lỗi có `PendingObjectCleanup` để retry; Board hard-delete giữ dữ liệu nếu không thể xác định hoặc dọn tệp. |
| Notifications | `/notifications`; `/notifications/unread-count`; `/notifications/read-all`; `/notifications/{id}/read`; `/notifications/{id}` | UC-COL-18 | REST center và isolation theo user đã triển khai. WebSocket push còn hoãn. |
| QuickNote | `/quick-notes`; `/quick-notes/{id}`; `/quick-notes/{id}/convert` | UC-COL-19, UC-PLAN-02 | CRUD và convert sang Card đã triển khai; convert và tạo Card dùng cùng transaction để giữ note nếu thất bại. |
| Planning read models và dependency | `/boards/{id}/calendar`; `/boards/{id}/list-view`; `/boards/{id}/dashboard`; `/cards/{id}/dependencies`; `/cards/{id}/dependencies/{dependencyId}` | UC-PLAN-01/03/04 | Đã triển khai theo phạm vi Core đã chọn. Chỉ trả dữ liệu Board được phép xem; dependency cùng Board, không trùng/self/cycle; dashboard Board rỗng trả số liệu 0. |

## Ngoài phạm vi của REST Core

BullMQ, Socket.IO/WebSocket delivery, AI, RAG, AI Agent/Tool Calling/Proposal và Knowledge Base processing được để cho các nhánh sau. AUTH email tiếp tục gửi trực tiếp theo ghi chú [deferred infrastructure](../CORE/deferred-infrastructure.md). API realtime được ghi riêng trong [WebSocket contract](websocket.md), không được hiểu là đã triển khai.

Các endpoint được mô tả trong OpenAPI cho Knowledge Base, AI, GitHub hoặc System Administration không thuộc phạm vi hoàn tất của ba nhánh Core. Không dùng tài liệu hóa đơn thuần làm bằng chứng rằng route đã chạy; đối chiếu route và integration test trước khi công bố trạng thái.
