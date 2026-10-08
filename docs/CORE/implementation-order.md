# Kế hoạch hoàn thiện REST Core

Ngày rà soát: **2026-10-08**. Kế hoạch gồm ba nhánh tích hợp sau Workspace và phân quyền. `feature/core-board-list`, `feature/core-card` và `feature/core-rest-completion` đã hoàn tất phạm vi REST Core; bốn nhóm A–D, tài liệu và OpenAPI đã tích hợp, các bước xác minh bên dưới đều đạt.

Lần đối chiếu chi tiết với SRS sau khi tích hợp vẫn phát hiện các sai khác ở vòng đời membership, audit vai trò, archive, storage và dữ liệu planning. Các bước khép khoảng trống được ghi trong [kế hoạch tiếp theo](plans/03-srs-core-gap-closure.md); trạng thái ba nhánh ở đây không có nghĩa toàn bộ SRS đã đạt.

**Mục tiêu:** Hoàn thiện REST Core theo SRS, bảo đảm ranh giới Workspace/Board, tính nguyên tử của thay đổi, kiểm soát ghi đồng thời và bộ kiểm thử xác nhận quyền trên mọi tài nguyên.

**Kiến trúc:** Tiếp tục kiến trúc modular monolith hiện có. Service chịu trách nhiệm phân quyền, nghiệp vụ và transaction; controller chỉ xử lý HTTP; repository truy cập persistence. HTTP/DB là nguồn sự thật; không thêm realtime hoặc worker trong ba nhánh này.

**Công nghệ:** Express 5, TypeScript, Zod, Prisma/PostgreSQL, Redis/email adapter hiện có, Node test runner qua `tsx`.

**Tài liệu đặc tả:** [Quy tắc nghiệp vụ](business-rules.md), [Kế hoạch và trạng thái Workspace](plans/02-workspace-membership.md), [Hợp đồng API](../api/README.md), SRS mục 2.4–2.5 và use case UC-Board-09, UC-List-10, UC-Card-12/13, UC-COL-16–19, UC-PLAN-01/03/04.

## Hiện trạng và phạm vi

- AUTH, shared authorization, Workspace/membership/invitation REST, Board/List REST và Card Core REST đã hoàn tất. `feature/core-board-list` thêm `List.statusGroup`, `BoardMembership.appointedBy` và `Card.archivedAt`; `feature/core-card` bổ sung Card CRUD, cardKey, OCC, move/reorder, lifecycle, giới hạn Board và ActivityLog nguyên tử.
- Schema/migration cho `CardLabel`, `CardDependency`, `Notification`, `QuickNote` và `PendingObjectCleanup` cùng field/index liên quan đã tích hợp ở nhánh REST completion. Task/Attachment operations có route và integration tests; OpenAPI đã được đối chiếu với các route Core.
- Trong SRS, Owner thuộc Workspace; PM thuộc từng Board. Không tạo `Workspace PM`. Chuyển Workspace Owner và chuyển Board PM luôn là hai nghiệp vụ riêng.
- Phạm vi này gồm REST CRUD/query cho Workspace, Board (bao gồm xóa vĩnh viễn theo điều kiện SRS), List, Card, Task, assignment, label, comments, attachments, activity, dependency, notification center và QuickNote; gồm cả các use case mở rộng dependency/calendar/dashboard đã được chọn trong kế hoạch Core.
- Loại khỏi plan: BullMQ (email và worker), Socket.IO/WebSocket delivery, AI, RAG, AI Agent/Tool Calling/Proposal và pipeline Knowledge Base. Card Attachment là luồng riêng; không tự đưa file sang Knowledge Base. Các thao tác REST vẫn phải đúng và bền vững dù chưa có push realtime.
- AUTH refresh-token transport, GitHub connector và module System Administration không thuộc ba nhánh Core này.

## Thứ tự triển khai ba nhánh

| Nhánh tích hợp                 | Phạm vi                                                                                                                                 | Phụ thuộc                                | Trạng thái           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------- |
| `feature/core-board-list`      | Board, PM, Board membership, List và invariant Workspace removal liên quan PM; hỗ trợ tối thiểu archive Card khi archive List           | Workspace/authorization                  | Hoàn tất             |
| `feature/core-card`            | Card CRUD, cardKey, status từ List, move/reorder, archive/restore, OCC và activity cơ bản                                               | Board/List đã tích hợp                   | Hoàn tất             |
| `feature/core-rest-completion` | Assignment/Label/Task, collaboration/Attachment, dependency, authorized Card queries/planning/dashboard, Notification REST và QuickNote | Card Core và schema/API contract đã khóa | Hoàn tất; gates pass |

Đây là ba nhánh/PR tích hợp. Trong nhánh ba, bốn session nghiệp vụ có thể code ở worktree riêng; chỉ người tích hợp sửa `schema.prisma`, migration, router tổng, shared authorization, OpenAPI dùng chung. Các session không commit trực tiếp lên cùng working tree.

## Nhánh 1 — Board, PM và List

### Phạm vi

- Tạo/xem/cập nhật/archive/restore Board và quản lý Board membership.
- Chưa mở endpoint xóa vĩnh viễn ở nhánh này; nhánh 3 chỉ thêm sau khi có quy trình dọn object storage an toàn, có thể retry.
- Tạo Board, BoardMembership(PM) và ba List mặc định To Do, In Progress, Done trong cùng transaction. Nếu Owner không chỉ định PM khác thì Owner đồng thời làm PM mặc định.
- Chỉ Workspace Owner phân công/chuyển PM. Người được chọn phải là user ACTIVE và là thành viên Workspace; ghi `appointedBy`. Chuyển PM nguyên tử trên đúng Board: PM cũ thành MEMBER, PM mới thành PM; không đổi Workspace membership hoặc Board khác.
- Owner đọc/quản trị mọi Board trong Workspace; PM chỉ Board được giao; Member chỉ Board có membership. System Admin không có quyền đọc nội dung theo vai trò admin.
- List có `statusGroup = TODO | IN_PROGRESS | DONE` tách khỏi tên hiển thị; nhiều List có thể thuộc cùng group. Thêm, đổi tên, đổi `statusGroup`, reorder và archive List; position/re-index được ghi nguyên tử.
- Khi archive List có Cards, request phải chọn đúng một cách xử lý: archive toàn bộ Cards trong List hoặc chuyển chúng sang một List đang hoạt động cùng Board. Không hard-delete; restore List không tự restore Cards đã archive. Đây là hỗ trợ archive tối thiểu, không kéo Card CRUD/OCC sang nhánh này.
- Trước khi xóa/rời Workspace member, phải chuyển mọi Board PM mà người đó đang giữ; Owner phải chuyển quyền Workspace riêng và xử lý các PM assignment của mình. Sau khi rời, thu hồi Board membership/assignment nhưng giữ Card, Comment, Attachment và lịch sử.

### Mô hình dữ liệu và API được phụ trách

- Bổ sung các field thiếu cho Board/List/BoardMembership và `Card.archivedAt` tối thiểu, theo contract được chốt trước migration. Migration phải backfill dữ liệu hiện có và kiểm tra invariant PM; không gán giả lịch sử `appointedBy` nếu không thể xác định người bổ nhiệm.
- Giữ unique constraint/index hiện có cho tối đa một Owner mỗi Workspace và tối đa một PM mỗi Board. Bảo đảm tối thiểu một Owner/PM qua transaction tạo/chuyển và kiểm tra invariant; unique index đơn lẻ không bảo đảm có ít nhất một.
- Sửa `src/modules/boards/routes/index.ts`; tạo controller/service/repository/DTO và test Board/List tương ứng; mở rộng `src/shared/authorization/access.service.ts` chỉ khi test chỉ ra policy thiếu.
- OpenAPI và endpoint matrix cập nhật cùng nhánh; không đổi AUTH.

### Tiêu chí nghiệm thu

- Test Board create rollback nếu không thể tạo PM/default Lists; Board mới luôn có đúng một PM.
- Test transfer PM đồng thời không tạo 0/2 PM; `appointedBy` đúng; chuyển role không làm đổi membership Workspace hay Board khác. Chốt cơ chế serialize/retry cho hai request chuyển PM trên cùng Board thay vì chỉ dựa vào kiểm tra trước khi ghi.
- Test Owner/PM/Member/System Admin theo SRS, bao gồm ID Board và List chéo scope.
- Test List statusGroup, giới hạn 30 Lists/Board, reorder concurrent/re-index, hai nhánh xử lý Cards khi archive List và restore List không tự restore Card. Test migrate dữ liệu cũ và giữ nguyên dữ liệu; không cascade hard-delete.

## Nhánh 2 — Card Core

### Phạm vi

- Card create/list/get/update, move/reorder trong Board, archive/restore và soft-delete; kiểm tra Board/List cùng scope và active parent.
- Bổ sung `cardKey` duy nhất trong Board, description Markdown, start/due dates, priority và archive/concurrency fields theo SRS/contract. `startDate <= dueDate`; thời gian lưu UTC.
- Trạng thái Card được suy ra từ `List.statusGroup`; không lưu một Card status độc lập gây lệch. Hoàn thành Task không tự chuyển Card sang Done.
- Mọi update/move dùng OCC theo `updatedAt`: cập nhật có điều kiện trên giá trị client đã đọc; stale version trả `409 CARD_CONFLICT`, không ghi đè âm thầm.
- Move/reorder kiểm tra Board/List đích, cập nhật position và Card trong transaction. Dependency blocker sẽ được gắn vào guard Done ở nhánh 3 sau khi dependency service có contract.
- Tạo `ActivityLog` và ghi Activity cơ bản cho tạo/sửa/move/archive trong cùng transaction; thay đổi nghiệp vụ và activity phải cùng thành công/thất bại. Nhánh 3 chỉ thêm event cho các năng lực mới.

### Mô hình dữ liệu và API được phụ trách

- Bổ sung Card fields/indexes và `ActivityLog` còn thiếu; xác nhận định danh `cardKey` và uniqueness `(boardId, cardKey)`.
- Sửa `src/modules/cards/routes/index.ts`; xây Card controller/service/repository/DTO; giữ các thao tác ghi trong service để các module sau tái sử dụng.
- Dùng `updatedAt` làm OCC token theo `docs/api/conventions.md`; bảo đảm token thay đổi sau mọi lần ghi kể cả các request sát nhau. Nếu timestamp không bảo đảm điều đó, chốt token phiên bản riêng và đồng bộ OpenAPI trước khi triển khai client-facing route.

### Tiêu chí nghiệm thu

- Test CRUD, IDOR/nested scope, giới hạn Card/Board, cardKey uniqueness và ngày bắt đầu/hạn chót.
- Test status đổi theo List group sau khi move hoặc đổi `statusGroup`. Test Task completion chỉ đổi tiến độ Task thuộc gate nhánh 3, sau khi Task được triển khai.
- Test hai cập nhật cùng `updatedAt`: đúng một request thành công, request stale nhận 409 và dữ liệu không mất.
- Test move/reorder transaction rollback và thứ tự cuối cùng hợp lệ khi có request cạnh tranh.
- Test archive giữ dữ liệu; restore chỉ thành công khi Board/Workspace cha hoạt động và actor có quyền. Soft-delete giữ child resources và ActivityLog, không cascade xóa lịch sử.

## Nhánh 3 — Năng lực Core và tích hợp

### Chốt contract trước khi chia lane

Người tích hợp khóa schema, migration và API contract chung cho các model còn thiếu (CardLabel, CardDependency, Notification, QuickNote) cùng field/index cần thiết; `ActivityLog` đã được tạo ở nhánh 2. Sau đó phân quyền file rõ ràng; các session song song không sửa `schema.prisma`, migration, shared access policy hoặc route aggregator. Mỗi session trả code, tests, OpenAPI fragment và danh sách quyết định cần tích hợp.

**Trạng thái:** Mốc này đã hoàn tất; các nhóm A–D đã được tích hợp. Nội dung bên dưới mô tả phạm vi và tiêu chí nghiệm thu, không phải việc còn chờ bắt đầu.

### Bốn nhóm việc song song

| Nhóm                             | Phạm vi phụ trách                                                                                                                              | Điều kiện bất biến khi nghiệm thu                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Assignment, Label, Task**   | Card child-resource services/controllers/tests; không sửa Card mutation service lõi                                                            | Assignee có quyền trên Board; Assignment/Label/CardLabel không trùng; Label cùng Board; tối đa 50 Tasks/Card; hoàn tất Task chỉ cập nhật tiến độ, không đổi Card sang Done.                                                                  |
| **B. Collaboration và tệp Card** | Comment/Activity-query/Attachment services/controllers/tests và object-storage cleanup service; không sửa Card mutation service lõi            | Comment theo quyền tác giả; activity phân trang mới nhất trước; Attachment chỉ thuộc Card, không phải Knowledge Base; upload kiểm tra quyền, MIME/dung lượng và metadata; cleanup object có thể retry; không xóa lịch sử khi membership rời. |
| **C. Dependency**                | Dependency services/controllers/tests trong khu vực riêng của `modules/planning`; đề xuất guard cho người tích hợp                             | Cùng Board, active, không self/duplicate/cycle; thao tác cạnh tranh không tạo cycle; move Card hoặc đổi List group làm Card vào DONE bị chặn khi prerequisite chưa DONE.                                                                     |
| **D. Read models và cá nhân**    | Calendar/dashboard queries trong khu vực riêng của `modules/planning`; Notification và QuickNote services/controllers/tests trong module riêng | Calendar/overdue/Dashboard chỉ đọc Board được phép; status lấy từ List; Board rỗng trả zero; Notification list/read-all/delete chỉ thuộc user hiện tại; QuickNote CRUD và convert-to-Card không mất note khi tạo Card thất bại.              |

### Chốt phạm vi theo SRS

- UC-Card-13 mô tả filter tức thời trên dữ liệu Board đã tải ở client. Giữ hành vi đó làm mặc định; không thêm search endpoint server-side trùng lặp nếu chưa có tiêu chí paging/dữ liệu lớn và contract được duyệt. Query Board server vẫn phải lọc theo quyền và trả đủ dữ liệu hợp lệ.
- Calendar/List View, Dependency và Dashboard thuộc nhóm mở rộng `[E]` trong SRS nhưng được đưa vào plan này theo phạm vi Core bro đã chọn.
- UC-COL-18 Notification Center và UC-COL-19 QuickNote có REST trong plan. Không gửi WebSocket push hoặc email queue; ghi rõ phần delivery còn thiếu do đã loại Socket.IO/BullMQ.
- Card Attachment tách khỏi Knowledge Base Document/RAG. SRS có xung đột giới hạn tệp (25 MB trong UC-Card-12 so với 5/15 MB ở mục giới hạn); dùng mức 25 MB theo API convention hiện tại và giữ cờ cần xác minh, không coi đây là quyết định SRS cuối cùng.
- Xử lý archive không đồng nghĩa xóa. Nested resources luôn kiểm tra Board cha; khi xóa membership thu hồi access/assignment nhưng giữ nội dung và lịch sử.

### Tiêu chí nghiệm thu tích hợp cuối

- Đã tích hợp các lane lên nhánh ba: Dependency guard nằm trên Card move và đổi `List.statusGroup`; Assignment/Comment tạo Notification; QuickNote conversion dùng cùng transaction boundary với Card create; các Card query và Board hard-delete route đã được nối. Cleanup lỗi được lưu trong `PendingObjectCleanup` và retry idempotent; không dựa vào BullMQ.
- Audit IDOR, nested-resource spoofing, Board membership revocation, locked user, Owner/PM transitions, archive/frozen parent, dependency cycle race, OCC race, notification isolation và data retention.
- Test xóa vĩnh viễn Board theo SRS: từ chối Board chưa archive/sai actor/sai tên; nếu Attachment thiếu `storageKey` hoặc cleanup object storage lỗi thì giữ nguyên relational rows và báo lỗi; cleanup phải idempotent để retry an toàn nếu lần xóa DB thất bại sau khi object đã được dọn.
- Test upload khi ghi DB thất bại đồng thời xóa object cũng thất bại: phải lưu `storageKey` trong `PendingObjectCleanup` để lần upload sau hoặc tác vụ retry gọi service cleanup có thể thử lại; không chấp nhận nuốt lỗi rồi để object mồ côi không có đường khôi phục. Cơ chế retry này không yêu cầu BullMQ.
- Đồng bộ OpenAPI/endpoint matrix với route chạy thật; endpoint tài liệu hóa không được xem là implementation.
- Kết quả xác minh ngày 2026-10-08: Prisma validate đạt; trạng thái migration đã cập nhật; TypeScript typecheck/build đạt; `pnpm test` đạt **82/82** khi chạy tuần tự trên PostgreSQL Docker; Prettier đạt; OpenAPI loader ghép thành công **92 path / 122 operation**. `prisma migrate dev` không qua shadow database do lỗi chạy lại một migration cũ (P3006/P1014); migration mới được áp dụng bằng `migrate deploy` sau khi xác nhận chỉ có migration bổ sung đang chờ. BullMQ, Socket.IO, AI/RAG/Agent và AUTH transport vẫn nằm ngoài phạm vi; không tuyên bố hoàn thành toàn bộ SRS.

## Quản lý nhánh và quyền sở hữu file

1. `feature/core-board-list` đã hoàn tất; dùng đây làm nền cho Card Core.
2. `feature/core-card` đã hoàn tất trên nền Board/List; giữ một owner cho Card fields, OCC, move/reorder và Activity Core.
3. Đã tạo `feature/core-rest-completion` trên nền Card Core đã review/tích hợp. Người tích hợp chốt migration/contract đầu nhánh; bốn lane A–D được triển khai trong worktree riêng rồi tích hợp vào nhánh ba.
4. Mỗi nhánh là một đơn vị review/commit riêng. Không tạo branch song song cùng sửa Prisma, authorization chung hoặc Board/Card mutation path. Rebase/merge theo thứ tự; không giả định test của nhánh cha còn đủ sau khi tích hợp.

## Tài liệu SRS đã đối chiếu

- Phân quyền, Owner/PM, Board access, Card/Task, member lifecycle, archive và UTC: mục 2.4.1–2.4.10, PDF trang 21–25.
- Quan hệ Core và invariant dữ liệu: mục 2.5.1 và 2.5.4, PDF trang 26 và 29.
- Use cases: UC-WS-06/07/08 (trang 48–53), UC-Board-09/UC-List-10 (trang 53–57), UC-Card-12/13 (trang 57–61), UC-COL-15–19 (trang 61–68), UC-PLAN-01/03/04 (trang 69–75).

SRS yêu cầu email lời mời qua BullMQ; dùng adapter gửi trực tiếp hiện tại là quyết định hoãn có ghi nhận tại [deferred-infrastructure.md](deferred-infrastructure.md), không phải tuyên bố đáp ứng đủ yêu cầu SRS đó.
