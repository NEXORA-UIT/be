# Quyết định và trạng thái BullMQ, Socket.IO

Ngày ghi nhận: **2026-10-07**. Đây là quyết định về **thứ tự triển khai**, không phải thay đổi yêu cầu nghiệp vụ trong SRS.

- Quyết định ngày 2026-10-23: hoàn thiện BullMQ cho email AUTH/Workspace, reminder và bảo trì Attachment; hoàn thiện Socket.IO cho realtime Core theo các kế hoạch [realtime](plans/05-socketio-realtime-srs.md) và [BullMQ](plans/06-async-bullmq.md).
- Cấu hình `WORKSPACE_INVITE_URL` thành trang nhận lời mời riêng của frontend (ví dụ `http://localhost:5173/workspace-invitations`). Email sẽ thêm query parameter `token`; không dùng `AUTH_VERIFY_URL` của flow đăng ký. Nếu thiếu cấu hình, API mời/gửi lại lời mời trả lỗi trước khi ghi lời mời mới.
- API dùng producer BullMQ; worker chạy cùng monolith theo mặc định hoặc bằng process riêng. Socket.IO chỉ phát sau khi transaction nghiệp vụ đã commit; HTTP/DB vẫn là nguồn sự thật.
- SRS yêu cầu gửi email lời mời qua hàng đợi; implementation dùng BullMQ producer và worker để đáp ứng yêu cầu này.
- Trạng thái thực tế cần được xác nhận bằng test/build của hai repo; không xem tài liệu hoặc dependency đã cài là bằng chứng flow đã chạy.

Plan thực hiện Workspace: [02-workspace-membership.md](plans/02-workspace-membership.md).
