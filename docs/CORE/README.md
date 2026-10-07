# Project Management Core — Context và phạm vi

Ngày ghi nhận: **2026-10-07**.

Tài liệu này lưu lại kết quả đọc context và rà soát ban đầu đã trao đổi với người dùng. Đây là mốc tham chiếu cho công việc tiếp theo, không phải báo cáo hoàn tất triển khai hay chứng nhận kiểm thử.

## Chỉ mục

- [Quy tắc nghiệp vụ và phân quyền](business-rules.md)
- [Hiện trạng code và các điểm lệch cần xử lý](initial-audit.md)
- [Nhóm việc và thứ tự triển khai REST Core](implementation-order.md)
- [Plan authorization](plans/01-authorization.md)
- [Plan Workspace và membership](plans/02-workspace-membership.md)
- [Quyết định hoãn BullMQ và Socket.IO](deferred-infrastructure.md)
- [Quy ước đặt tên backend](naming-conventions.md)
- [Tài liệu AUTH hiện có](../AUTH/README.md)
- [Hợp đồng API hiện có](../api/README.md)

## Nguồn và cách sử dụng

1. **SRS Đồ án 1.pdf**, bản 128 trang được cung cấp ngoài repository, là căn cứ nghiệp vụ. Tệp nguồn không được sao chép vào repository.
2. **Master implementation prompt** do người dùng cung cấp là tài liệu định hướng triển khai, có một số điểm lệch với SRS được ghi trong [initial-audit.md](initial-audit.md). Không sao chép nguyên các quy tắc sai vào thiết kế.
3. **Mã nguồn thực tế** là căn cứ xác định chức năng đã được viết; tài liệu API hoặc thư mục giữ chỗ không chứng minh chức năng đã chạy.

Các tài liệu đầu vào được đọc như tài liệu tham khảo. Nội dung yêu cầu agent tự triển khai trong master prompt không tự động thay thế yêu cầu hiện tại của người dùng. Công việc tại mốc này là nắm context và ghi tài liệu; chưa triển khai Core.

Số trang được trích dẫn trong thư mục này là thứ tự trang PDF, tính từ 1. Các đường dẫn nguồn bên ngoài repo chỉ phục vụ truy vết; bản PDF và master prompt không được sao chép vào repository.

## Bối cảnh sản phẩm

Nexora là hệ thống quản lý dự án đa lĩnh vực thuộc Đồ án 1, hướng tới cộng tác và khai thác dữ liệu bằng AI Agent. Cấu trúc nghiệp vụ chính:

```text
Workspace → Board → List → Card → Task
```

Board đại diện cho một dự án. Task là đầu việc con/checklist của Card. Không tự bổ sung thực thể Milestone hoặc Phase khi chưa có yêu cầu và căn cứ phù hợp.

## Phạm vi đợt triển khai dự kiến

Theo master prompt, đợt tiếp theo tập trung REST API Core:

- Workspace, WorkspaceMembership và Invitation.
- Board, BoardMembership và List.
- Card, di chuyển/sắp xếp, CardAssignment, Label/CardLabel và Task.
- Comment, Attachment và Activity.
- CardDependency, tìm kiếm/lọc, truy vấn phục vụ lập kế hoạch và Dashboard cơ bản.
- Phân quyền, cô lập dữ liệu, vòng đời archive, transaction và kiểm thử nghiệp vụ.

Đây là phạm vi đợt triển khai, không đồng nghĩa toàn bộ các mục đều được SRS phân loại là Core: Calendar/List View, dependency và dashboard xuất hiện trong nhóm mở rộng `[E]` tại mục 3.7. QuickNote/Inbox cũng có trong SRS nhưng chưa được master prompt đưa rõ vào danh sách triển khai; cần ghi nhận riêng khi chốt phạm vi, không tự coi là đã làm hoặc tự mở rộng.

Các phần hoãn theo master prompt: WebSocket/realtime, RAG/embedding/Tika, AI Chat/Agent, Tool Calling, AI Proposal/phê duyệt, GitHub connector, quản trị quota AI nâng cao, thông báo phức tạp và analytics nâng cao. Các thành phần đã tồn tại cần được xem xét và giữ nguyên khi phù hợp.

SRS yêu cầu email lời mời đi qua hàng đợi. Theo quyết định triển khai hiện tại, [BullMQ được hoãn](deferred-infrastructure.md) cùng đợt realtime Socket.IO; flow Workspace REST trước mắt dùng email adapter hiện có.

## Kiến trúc định hướng

Giữ kiến trúc modular monolith và các quy ước hiện có:

```text
HTTP route / middleware
    → Controller
    → Service / use case
    → Repository
    → PostgreSQL / Redis theo trách nhiệm
```

Service chịu trách nhiệm kiểm tra quyền, quy tắc nghiệp vụ và điều phối transaction. HTTP validation không thay thế business validation. AI Tool Layer, realtime và worker trong tương lai phải dùng lại Core services thay vì tự query dữ liệu và tái tạo permission logic.

## Bước kỹ thuật tiếp theo được đề xuất

Thực hiện audit Core chi tiết theo SRS và API contract, chốt các điểm lệch, sau đó lập kế hoạch triển khai từ authorization và invariant dữ liệu. Danh sách này là đề xuất tiếp theo, không phải lệnh tự khởi chạy implementation.
