# Core — Quy tắc nghiệp vụ và phân quyền

Căn cứ: SRS được ghi trong [README](README.md). Các mục dưới đây là quy tắc cần bảo toàn khi thiết kế và triển khai; chưa phải mô tả tính năng đã có trong code.

## 1. Phân quyền hai cấp

Nguồn: SRS mục 2.4.1–2.4.4, 2.5.1 và 2.5.4, trang 21–22, 26, 29.

| Phạm vi / vai trò   | Quy tắc                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| WorkspaceMembership | Chỉ có OWNER hoặc MEMBER; mỗi Workspace đúng một Owner                          |
| Người tạo Workspace | Trở thành Owner trong cùng transaction tạo Workspace                            |
| BoardMembership     | PM hoặc MEMBER; mỗi Board đúng một PM                                           |
| Owner               | Quản trị Workspace, truy cập mọi Board, phân công/chuyển PM                     |
| PM                  | Quản lý Board được phân công; không mặc nhiên quản trị Workspace hay Board khác |
| Member              | Chỉ truy cập Board được cấp membership tương ứng                                |
| System Admin        | Quản trị vận hành; không tự có quyền đọc nội dung dự án                         |

Owner có thể đồng thời là PM của một hoặc nhiều Board. Tạo Board và BoardMembership(PM) phải nguyên tử; nếu không chọn PM khác, Owner là PM mặc định. Ghi nhận người phân công qua `appointedBy` hoặc nhật ký tương đương. Board mới có các List mặc định To Do, In Progress, Done (UC-Board-09, trang 53).

Chuyển Owner của Workspace và chuyển PM của Board là hai nghiệp vụ độc lập. Khi chuyển PM, PM cũ trở thành Board MEMBER; không thay đổi membership Workspace hoặc Board khác. Người được chọn phải là thành viên hoạt động của Workspace; nếu chưa có BoardMembership, tạo trong cùng transaction (trang 55).

Mọi kiểm tra quyền phải diễn ra ở backend, bao gồm xác minh chuỗi sở hữu Workspace → Board → List → Card. Không tin ID tài nguyên con chỉ vì URL chứa một parent ID hợp lệ.

## 2. Thành viên và lời mời

Nguồn: mục 2.4.6, 2.5.4, UC-WS-06 và UC-WS-07, trang 23, 29, 49–53.

- Chấp nhận lời mời hợp lệ mới tạo membership Workspace; quyền Board cấp riêng.
- WorkspaceInvitation lưu business state trong PostgreSQL; token ngắn hạn ở Redis, TTL 7 ngày theo UC-WS-06. SRS yêu cầu email lời mời xử lý nền qua BullMQ; [quyết định triển khai hiện tại](deferred-infrastructure.md) hoãn BullMQ và dùng email adapter trực tiếp trong giai đoạn Workspace REST.
- Rời/xóa thành viên phải thu hồi quyền Board và gỡ phân công còn hiệu lực trong phạm vi tương ứng.
- Nếu thành viên đang là PM, phải có người thay thế trên từng Board trước khi hoàn tất rời/xóa.
- Owner phải chuyển quyền Owner trước khi rời Workspace, đồng thời xử lý những Board mình đang giữ PM.
- Không tự xóa Card, comment, attachment, tác giả hoặc lịch sử khi membership bị thu hồi. Tham gia lại không tự khôi phục quyền/phân công cũ.

## 3. Card, List, Task và các quan hệ

Nguồn: mục 2.4.4–2.4.5, 2.5.1, 2.5.4 và UC-Card-12, trang 22–23, 26, 29, 57–59.

- Mỗi List thuộc một Board và có `statusGroup` TODO, IN_PROGRESS hoặc DONE, độc lập với tên hiển thị.
- Trạng thái Card suy ra từ List; đổi nhóm trạng thái List phải giữ nhất quán trạng thái và thống kê của các Card bên trong.
- Hoàn thành Task không tự chuyển Card sang Done.
- Member có quyền trên Board được sửa/di chuyển Card kể cả khi không là assignee. Assignment thể hiện trách nhiệm, không tạo độc quyền chỉnh sửa.
- Assignee phải có quyền tham gia Board. Label và Card phải cùng Board; không tạo trùng membership, assignment hoặc CardLabel.
- Card có UUID nội bộ và `cardKey` dễ đọc, duy nhất trong Board.
- Quyền sửa Card không tự trao quyền sửa/xóa mọi comment hoặc attachment bên trong.

## 4. Dependency và điều kiện Done

Nguồn: mục 2.5.1, UC-Card-12 và UC-PLAN-03, trang 26, 59, 72–73.

- Hai Card phải cùng Board, còn tồn tại và chưa archive khi tạo dependency.
- Cấm tự phụ thuộc, trùng cặp và chu trình.
- Không cho chuyển Card sang Done khi còn Card tiên quyết chưa hoàn thành.
- Tạo/xóa dependency phải ghi hoạt động tương ứng; kiểm tra lại trạng thái nếu dữ liệu thay đổi trong lúc thao tác.

Kiểm tra cycle trước insert đơn thuần chưa chứng minh an toàn khi có request đồng thời; chiến lược transaction/concurrency cần được đánh giá trong thiết kế chi tiết.

## 5. Archive, khóa tài khoản và đóng băng

Nguồn: mục 2.4.7 và 2.4.10, trang 23–25.

- Archive khác hoàn thành và khác xóa; giữ dữ liệu, loại khỏi phạm vi làm việc đang hoạt động.
- Đối tượng archive hoặc có cha archive không nhận chỉnh sửa nghiệp vụ thông thường.
- Restore yêu cầu cha hoạt động và quyền phù hợp. Restore cha không tự restore con đã archive riêng.
- Khóa tài khoản chặn cả phiên đang có nhưng không tự xóa lịch sử hoặc chuyển vai trò PM.
- Workspace frozen chặn thay đổi dữ liệu và tác vụ AI; người có quyền vẫn đọc được theo chế độ chỉ đọc.

Chi tiết xóa/soft-delete và xử lý Card khi archive List phải được đối chiếu từng use case trước triển khai; không suy ra cascade delete từ quan hệ dữ liệu.

## 6. Thời gian và quá hạn

Nguồn: mục 2.4.9 và UC-PLAN-01/04, trang 24, 69–70, 74–75.

- Nếu có cả hai ngày: `startDate <= dueDate`.
- Lưu/truyền timestamp UTC, ISO 8601; client chuyển múi giờ hiển thị.
- Card quá hạn khi có dueDate, thời điểm hiện tại lớn hơn dueDate, không ở nhóm Done và Card cùng các cha đang hoạt động.
- Card không có dueDate không quá hạn; mở lại Card từ Done phải đánh giá quá hạn theo trạng thái hiện tại.
- Dashboard dùng trạng thái từ List và đúng phạm vi quyền; Board rỗng trả thống kê hợp lệ bằng 0.

Ưu tiên tính overdue từ dữ liệu nguồn thay vì lưu một cờ có thể lỗi thời. Quy ước đầu vào chỉ có ngày và ngưỡng “sắp đến hạn” cần được làm rõ khi thiết kế API.

## 7. Lịch sử, tệp và tính nhất quán

Nguồn: mục 2.4.8, UC-COL-16/17, mục 6.3.1–6.3.2, trang 24, 63–65, 122.

- Attachment của Card không tự trở thành Document trong Knowledge Base.
- Comment sửa/xóa theo tác giả và quyền được đặc tả; không cho thành viên khác tùy ý sửa.
- Activity phải phản ánh thao tác thực sự; master prompt yêu cầu backend sinh lịch sử, không mở API để client tự tạo sự kiện nghiệp vụ giả.
- Move/reorder Card và chuyển Owner/PM phải giữ invariant qua transaction.
- Cập nhật Card dùng optimistic concurrency control; dữ liệu đã thay đổi phải trả 409 Conflict thay vì âm thầm ghi đè.
- Nếu Activity cần nguyên tử cùng thao tác nghiệp vụ, rollback phải áp dụng cho cả hai.

## 8. Quy ước giao tiếp

Nguồn: mục 4.2.1–4.2.2, trang 105.

- API version `/api/v1`; envelope thành công `{ success: true, data: ... }`, thất bại `{ success: false, error: { code, message, details } }`.
- Phân trang `page`/`limit`, không dùng cursor trong phạm vi đồ án.
- Access token gửi qua Bearer header. SRS yêu cầu refresh token qua cookie HttpOnly, Secure, SameSite và không xuất hiện trong JSON response; code hiện tại có khác biệt, xem [initial-audit.md](initial-audit.md).
