# Kế hoạch hoàn thiện luồng bất đồng bộ BullMQ

> **Dành cho người triển khai:** thực hiện theo từng phần, kiểm tra hợp đồng SRS và giữ nguyên quy tắc nghiệp vụ hiện có.

**Mục tiêu:** Đưa các tác vụ email và bảo trì Core vào BullMQ với retry, xử lý lỗi và worker chạy được cùng monolith hoặc bằng process riêng.

**Kiến trúc:** API ghi nghiệp vụ và enqueue job; Redis lưu queue; worker dùng lại email/storage/service hiện có. Lời mời và email AUTH chỉ báo đã nhận yêu cầu xử lý, không khẳng định email đã đến inbox. BullMQ không thay PostgreSQL cho dữ liệu nghiệp vụ và không dùng làm kênh broadcast realtime.

**Phạm vi:** email xác minh đăng ký, đặt lại mật khẩu, lời mời Workspace; email nhắc hạn Card; dọn Card Attachment đã đánh dấu pending. Không gồm Knowledge Base/RAG, GitHub, AI/Agent.

## Cổng nghiệm thu

- API trả về sau khi job đã được enqueue; enqueue lỗi phải được báo rõ và không để lời mời có thể chấp nhận nhưng không có job gửi thư.
- Worker xử lý retry có backoff, không gửi trùng do retry cùng job, và ghi nhận job lỗi cuối cùng để vận hành tra cứu.
- Worker tự khởi chạy cùng API theo cấu hình mặc định; có entrypoint riêng để chạy trên VPS/process khác mà không bật worker ở API.
- Tác vụ định kỳ tạo reminder/cleanup được enqueue bằng scheduler; lệnh chạy một lượt vẫn dùng để vận hành thủ công.
- Socket.IO vẫn phát sự kiện sau khi nghiệp vụ commit; queue và socket có kết nối riêng, không dùng queue làm broadcast.
- BE/FE có kiểm thử tương ứng; docs, env mẫu và OpenAPI mô tả đúng kết quả enqueue.

## Phần việc

1. Thêm BullMQ, queue theo loại tác vụ, worker, retry/backoff, jobId ổn định, xử lý graceful shutdown và entrypoint monolith/worker riêng.
2. Chuyển email AUTH và Workspace sang producer; giữ token raw chỉ trong payload job, token hash và trạng thái invitation theo hợp đồng nghiệp vụ.
3. Chuyển email nhắc hạn và dọn Attachment sang jobs. Scheduler chỉ tạo/enqueue công việc định kỳ, không thực thi SMTP/storage trực tiếp.
4. Nối worker vào khởi động API và cung cấp lệnh chạy worker độc lập; cập nhật Docker/VPS, env và docs tiếng Việt.
5. Kiểm tra enqueue, retry, lỗi gửi, invitation resend, cleanup retry và xử lý trùng; chạy typecheck/build/tests phù hợp.
