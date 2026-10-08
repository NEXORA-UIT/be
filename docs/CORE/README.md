# Core quản lý dự án — Bối cảnh và phạm vi

Ngày ghi nhận: **2026-10-08**.

Tài liệu này lưu quy tắc nghiệp vụ và kế hoạch theo module. Trạng thái thực tế cần đối chiếu với code và tài liệu module; contract API tự nó không chứng minh một flow đã triển khai.

## Chỉ mục

- [Quy tắc nghiệp vụ và phân quyền](business-rules.md)
- [Nhóm việc và thứ tự triển khai REST Core](implementation-order.md)
- [Plan authorization](plans/01-authorization.md)
- [Plan Workspace và membership](plans/02-workspace-membership.md)
- [Kế hoạch khép khoảng trống REST Core so với SRS](plans/03-srs-core-gap-closure.md)
- [Quyết định hoãn BullMQ và Socket.IO](deferred-infrastructure.md)
- [Quy ước đặt tên backend](naming-conventions.md)
- [Tài liệu AUTH hiện có](../AUTH/README.md)
- [Hợp đồng API hiện có](../api/README.md)

## Nguồn và cách sử dụng

1. **SRS Đồ án 1.pdf**, bản 128 trang được cung cấp ngoài repository, là căn cứ nghiệp vụ. Tệp nguồn không được sao chép vào repository.
2. **Master implementation prompt** là tài liệu định hướng; khi có khác biệt nghiệp vụ, đối chiếu SRS và quy tắc trong [business-rules.md](business-rules.md).
3. **Mã nguồn thực tế** là căn cứ xác định chức năng đã được viết; tài liệu API hoặc thư mục giữ chỗ không chứng minh chức năng đã chạy.

Các tài liệu đầu vào được đọc như tài liệu tham khảo. Nội dung yêu cầu agent tự triển khai trong master prompt không tự động thay thế yêu cầu hiện tại của người dùng.

Số trang được trích dẫn trong thư mục này là thứ tự trang PDF, tính từ 1. Các đường dẫn nguồn bên ngoài repo chỉ phục vụ truy vết; bản PDF và master prompt không được sao chép vào repository.

## Bối cảnh sản phẩm

Nexora là hệ thống quản lý dự án đa lĩnh vực thuộc Đồ án 1, hướng tới cộng tác và khai thác dữ liệu bằng AI Agent. Cấu trúc nghiệp vụ chính:

```text
Workspace → Board → List → Card → Task
```

Board đại diện cho một dự án. Task là đầu việc con/checklist của Card. Không tự bổ sung thực thể Milestone hoặc Phase khi chưa có yêu cầu và căn cứ phù hợp.

## Phạm vi REST Core dự kiến

Kế hoạch hoàn thiện REST Core được chia thành ba nhánh tích hợp trong [implementation-order.md](implementation-order.md):

- Board, BoardMembership/PM và List.
- Card Core: CRUD, status theo List, move/reorder, archive/restore, OCC và Activity cơ bản.
- Assignment, Label, Task, Comment, Card Attachment, Activity query, Dependency, truy vấn Calendar/List View/Dashboard, Notification Center REST và QuickNote.
- Phân quyền, cô lập dữ liệu, vòng đời archive, transaction và kiểm thử nghiệp vụ.

Calendar/List View, Dependency và Dashboard được ghi là nhóm mở rộng `[E]` trong SRS, nhưng nằm trong phạm vi REST Core đã chọn cho kế hoạch này. Notification Center và QuickNote được đưa vào vì là use case REST trong SRS; phần realtime delivery vẫn bị loại.

Ngoài kế hoạch: BullMQ/email queue, Socket.IO/WebSocket delivery, AI, RAG/embedding/Tika, AI Agent/Tool Calling/Proposal, pipeline tài liệu Knowledge Base, GitHub connector và quản trị quota AI nâng cao. Card Attachment vẫn là luồng riêng, không tự trở thành tài liệu Knowledge Base. Các gap SRS bị loại phải được ghi nhận, không tuyên bố đã hoàn thành toàn bộ SRS.

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

## Trạng thái triển khai

Ba nhánh `feature/core-board-list`, `feature/core-card` và `feature/core-rest-completion` đã triển khai phạm vi REST Core ban đầu. Lần kiểm tra ngày 2026-10-08 trên nhánh cuối đạt 82/82 test và typecheck, nhưng đối chiếu SRS còn các sai khác về membership, truy vết vai trò, archive, lưu trữ tệp và dữ liệu planning. [Kế hoạch khép các khoảng trống](plans/03-srs-core-gap-closure.md) là bước tiếp theo; chưa tuyên bố đáp ứng toàn bộ SRS. BullMQ và Socket.IO vẫn được hoãn.
