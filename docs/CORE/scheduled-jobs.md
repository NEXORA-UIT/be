# Tác vụ nền BullMQ

BullMQ chạy email và bảo trì Core trên Redis. API enqueue job rồi trả response; worker gửi email hoặc gọi service nghiệp vụ với retry exponential tối đa 5 lần. Job hoàn tất được giữ 24 giờ (tối đa 1.000 job); job lỗi cuối cùng được giữ 7 ngày (tối đa 5.000 job) để điều tra. Queue job có `jobId` ổn định để tránh enqueue trùng trong thời gian BullMQ còn giữ job.

Worker mặc định chạy cùng process API, nên trên một VPS chỉ cần start backend. Để tách process, đặt `BACKGROUND_WORKERS_ENABLED=false` cho API và chạy `pnpm worker:start` (hoặc `pnpm worker:dev` khi local). Chỉ một cấu hình worker cần gọi `upsertJobScheduler`; BullMQ phân phối job cho một worker trong nhóm và Redis giữ job khi process khởi động lại.

## Email

Đăng ký, đặt lại mật khẩu, mời Workspace, gửi lại lời mời và nhắc hạn Card đều vào queue `nexora-email`. API chỉ trả thành công sau khi Redis xác nhận enqueue; response 202 hoặc 200 tùy endpoint có nghĩa là đã tiếp nhận, không có nghĩa SMTP đã chấp nhận hay thư đã tới inbox. Worker retry lỗi SMTP tạm thời. Nếu retry hết, job được giữ ở trạng thái failed; người dùng có thể yêu cầu gửi lại theo flow hiện có.

Email invitation được enqueue sau khi token mới đã được ghi vào DB/Redis. Nếu enqueue thất bại, lời mời mới bị hủy hoặc token cũ được khôi phục. Reminder có khóa DB riêng cùng `emailQueuedAt`: nếu enqueue lỗi, lịch chạy sau có thể thử lại; nếu tiến trình dừng sau enqueue trước khi cập nhật mốc, `jobId` ổn định ngăn tạo job thứ hai. SMTP là at-least-once: nếu server SMTP nhận thư nhưng worker dừng trước khi BullMQ ghi nhận hoàn tất, thư có thể được gửi lại khi retry.

## Bảo trì và lịch chạy

Queue `nexora-maintenance` chạy dọn Card Attachment và tạo Notification nhắc hạn mỗi 5 phút. Cleanup giữ nguyên trạng thái retry/backoff trong PostgreSQL; worker xử lý tối đa số key đến hạn theo service hiện tại. Lệnh `pnpm jobs:run:local` enqueue một lượt bảo trì để xử lý ngay; `pnpm jobs:run` là lệnh production.

Redis dùng chung với Socket.IO adapter nhưng hai hệ thống có vai trò riêng: BullMQ lưu/điều phối công việc; Socket.IO Pub/Sub chuyển sự kiện realtime giữa các backend process. Không truyền event Board qua BullMQ.

## Cấu hình

- `BACKGROUND_WORKERS_ENABLED=true`: API tự khởi chạy workers và lịch bảo trì; mặc định bật nếu không khai báo.
- `REDIS_URL`: queue dùng cùng URL Redis của backend.
- `GMAIL_USER`, `GMAIL_APP_PASSWORD`: worker cần cấu hình SMTP để gửi thư.
- `WORKSPACE_INVITE_URL`, `AUTH_VERIFY_URL`, `AUTH_RESET_URL`: link được tạo trước khi enqueue email.

Job email chứa nội dung thư và link token trong Redis. Hãy giữ Redis trong mạng nội bộ có xác thực, ACL và giới hạn quyền truy cập.
