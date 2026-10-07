# Quyết định tạm hoãn BullMQ và Socket.IO

Ngày ghi nhận: **2026-10-07**. Đây là quyết định về **thứ tự triển khai**, không phải thay đổi yêu cầu nghiệp vụ trong SRS.

- Mail AUTH (xác nhận đăng ký và đặt lại mật khẩu) hiện gọi `sendEmail` trực tiếp trong request. Giữ nguyên flow đang chạy; chưa đưa BullMQ vào AUTH.
- Flow mời thành viên Workspace sẽ hoàn thiện bằng email adapter hiện có, chưa thêm queue/worker BullMQ. Chỉ trả thành công khi gửi mail thành công; nếu gửi thất bại, API báo lỗi và không để lại lời mời/token mới ở trạng thái có thể chấp nhận. Không mô tả response là “đã enqueue”.
- BullMQ cho email AUTH/Workspace và Socket.IO cho realtime sẽ được triển khai trong các đợt riêng sau. Không đưa chúng vào điều kiện hoàn tất flow Workspace REST hiện tại.
- Khi thêm BullMQ, giữ nguyên API nghiệp vụ, thay delivery adapter bằng producer/worker; bổ sung retry, idempotency và xử lý trạng thái gửi. Khi thêm Socket.IO, phát sự kiện sau khi transaction nghiệp vụ đã commit; HTTP/DB vẫn là nguồn sự thật.
- SRS có yêu cầu gửi email lời mời qua hàng đợi. Quyết định hoãn này là **khoảng cách tạm thời với SRS** cần được khép lại trước khi tuyên bố toàn bộ yêu cầu SRS hoàn tất.

Plan thực hiện Workspace: [02-workspace-membership.md](plans/02-workspace-membership.md).
