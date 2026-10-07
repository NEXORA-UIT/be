# Authorization Core — Implementation Plan

> **For implementers:** Thực hiện theo từng task, viết test hành vi/quyền trước code, review và chạy kiểm tra sau mỗi task. Plan này xây nền quyền cho [Workspace và membership](02-workspace-membership.md).

**Goal:** Mọi Core service kiểm tra quyền theo đúng hai cấp của SRS và xác minh quan hệ tài nguyên trước khi đọc hoặc sửa dữ liệu.

**Architecture:** `requireAuth` hiện có xác thực User và phiên. Tầng authorization mới nhận `userId` từ Auth, truy vấn membership/trạng thái mới nhất qua Prisma, trả một context có kiểu rõ ràng cho service. Route chỉ kết nối auth, validation và controller; business service gọi access service, kể cả khi sau này được AI/tool/worker gọi trực tiếp.

**Tech stack:** Express 5, TypeScript strict/ESM, Prisma/PostgreSQL, Zod, Node test runner qua `tsx --test`.

**Spec:** [SRS/Core business rules](../business-rules.md), [scope và thứ tự](../implementation-order.md); SRS PDF mục 2.4.1–2.4.7, 2.5.1, 5.2.3, trang PDF 21–26 và 114.

## Ranh giới và contract

- `WorkspaceMembership.role`: chỉ `OWNER | MEMBER`. Mỗi Workspace đúng một Owner; Owner có thể đọc/quản lý mọi Board trong Workspace.
- `BoardMembership.role`: chỉ `PM | MEMBER`. Mỗi Board đúng một PM; PM phải còn là thành viên Workspace. PM chỉ quản lý Board được giao.
- Member Workspace không tự đọc Board. Member Board mới có quyền trong Board đó. System Admin không tự được đọc nội dung dự án.
- Assignee không quyết định quyền sửa Card. Quyền của đối tượng con luôn đi theo Board chứa nó.
- Workspace/Board archive: cho phép đọc theo quyền, chặn thao tác ghi thông thường. Workspace frozen: cho phép đọc, chặn ghi. Các thao tác restore/unfreeze được gọi qua policy riêng.
- Trả `401` cho thiếu/sai phiên từ `requireAuth`; `404` khi resource không tồn tại; `403` khi resource tồn tại nhưng người dùng không có quyền. Không lộ nội dung resource trong lỗi `403`.

**Interfaces dự kiến để plan 02 và các module sau dùng:**

```ts
type WorkspaceAccess = { workspaceId: string; role: 'OWNER' | 'MEMBER'; archivedAt: Date | null; isFrozen: boolean };
type BoardAccess = { boardId: string; workspaceId: string; role: 'OWNER' | 'PM' | 'MEMBER'; boardArchivedAt: Date | null; workspaceArchivedAt: Date | null; isFrozen: boolean };

requireWorkspaceAccess(userId: string, workspaceId: string): Promise<WorkspaceAccess>;
requireWorkspaceOwner(userId: string, workspaceId: string): Promise<WorkspaceAccess>;
requireWorkspaceWriteAccess(userId: string, workspaceId: string): Promise<WorkspaceAccess>;
requireBoardAccess(userId: string, boardId: string): Promise<BoardAccess>;
requireBoardManager(userId: string, boardId: string): Promise<BoardAccess>;
requireBoardWriteAccess(userId: string, boardId: string): Promise<BoardAccess>;
requireResourceInBoard(resource: 'list' | 'card' | 'task' | 'comment' | 'attachment' | 'label', resourceId: string, boardId: string): Promise<void>;
```

Tên interface có thể đổi sau khi kiểm tra code cụ thể, nhưng plan 02 phải dùng cùng chữ ký đã chốt. `requireWorkspaceOwner` là quyền cấp Workspace; không tồn tại `Workspace PM`.

## Task 1 — Chốt schema nền và invariant quyền

**Files:** `prisma/schema.prisma`; migration mới trong `prisma/migrations/`; `tests/core/authorization-schema.integration.test.ts`.

- [ ] Viết test DB cho cặp membership duy nhất, role enum hợp lệ, một OWNER/Workspace và một PM/Board. Test race/concurrent creation hoặc transfer ở tầng service trong task tương ứng.
- [ ] Bổ sung `Workspace`, `WorkspaceMembership`, `Board`, `BoardMembership` với quan hệ User; field Workspace cần cho plan 02 (`name`, `description`, `archivedAt`, trạng thái frozen), field Board tối thiểu cho quan hệ và archive. Trong cùng bước nền, định nghĩa quan hệ và khóa của `List`, `Card`, `CardAssignment`, `Label`, `Task`, `Comment`, `Attachment` để Task 3 kiểm tra nested scope và plan 02 có thể test cleanup assignment. Các trường nghiệp vụ chi tiết của Card/cộng tác được bổ sung ở plan module tương ứng; không tạo API Card tại đây. Thống nhất tên với OpenAPI/ERD trước khi migrate.
- [ ] Thêm `@@unique([workspaceId,userId])`, `@@unique([boardId,userId])`, index theo scope. Migration SQL bổ sung unique partial index `WHERE role = 'OWNER'` cho WorkspaceMembership và `WHERE role = 'PM'` cho BoardMembership để chặn **nhiều hơn một**; việc **có ít nhất một** được bảo vệ bằng transaction khi tạo/chuyển và test API/service. Không tuyên bố partial index một mình bảo đảm “đúng một”.
- [ ] Tạo migration có thể áp dụng trên DB hiện tại, không reset/xóa bảng AUTH. Chạy `pnpm db:validate`, `pnpm db:generate`, migration trên DB test, rồi test schema.

**Gate:** Data model đủ để kiểm tra quyền, không thay đổi AUTH và không sinh Board thiếu PM qua API về sau.

## Task 2 — Access service đọc vai trò mới nhất

**Files:** `src/shared/authorization/access.service.ts` và `access.repository.ts` (mới); `src/shared/authorization/access.errors.ts` (mới); `tests/core/authorization.service.test.ts`.

- [ ] Viết test Owner được vào mọi Board; PM chỉ vào Board mình quản lý; Member chỉ vào Board đã tham gia; System Admin không có ngoại lệ nội dung; user bị xóa membership mất quyền ngay cả khi access token còn hạn.
- [ ] Triển khai `requireWorkspaceAccess/Owner` và `requireBoardAccess/Manager` theo interfaces trên. Kiểm tra `User.status = ACTIVE` hoặc dựa vào Auth đã xác minh tại đầu vào, nhưng khi gọi Core từ worker/tool phải tái kiểm tra account. Không cache quyền qua request khác.
- [ ] Trả `AppError` theo envelope/error middleware hiện có. Truy vấn chỉ đọc scope cần lọc bằng quyền trong query khi lấy danh sách, không lấy hết rồi lọc ở controller.
- [ ] Chạy test service, typecheck. Không thêm vai trò `ADMIN` hoặc `VIEWER` từ gợi ý của công cụ lập kế hoạch: SRS không có hai vai trò này.

**Gate:** Các service Core có thể tái sử dụng quyền độc lập transport HTTP.

## Task 3 — Trạng thái archive/frozen và scope của tài nguyên con

**Files:** `src/shared/authorization/access.service.ts`, `resource-scope.service.ts` (mới); `tests/core/authorization-scope.integration.test.ts`.

- [ ] Viết test write bị chặn khi Workspace/Board đã archive hoặc Workspace frozen; read hợp lệ vẫn được phép. Restore dùng `requireWorkspaceOwner`/`requireBoardManager` và kiểm tra cha thay vì dùng write guard chung.
- [ ] Viết test nested ID spoofing: URL Board A + List/Card/Label của Board B bị từ chối; Comment/Task/Attachment phải lần theo Card → List → Board. Kiểm tra luôn Board/Workspace cha đang hoạt động trước mutation.
- [ ] Triển khai `requireWorkspaceWriteAccess`, `requireBoardWriteAccess`, `requireResourceInBoard`. Dùng Prisma `where` theo chain sở hữu; tránh truy vấn rời rạc rồi tin ID request.
- [ ] Chạy test tích hợp âm tính và typecheck.

**Gate:** Các module sau có thể gọi một helper thống nhất để bảo vệ nested resources.

## Task 4 — Gắn vào API và giữ service là điểm kiểm tra cuối

**Files:** `src/modules/workspaces/routes/index.ts` khi plan 02 bắt đầu; các route Board/Card ở nhóm tiếp theo; `tests/core/authorization-http.integration.test.ts`.

- [ ] Test HTTP `401/403/404` với User không đăng nhập, Member Workspace chưa vào Board, Member Board không có quyền PM, System Admin không có membership và ID chéo scope.
- [ ] Gắn `requireAuth` hiện có tại route Core; controller truyền `request.auth.userId` cho service. Service phải tự gọi authorization; middleware HTTP có thể precheck để trả lỗi sớm nhưng không là lớp bảo vệ duy nhất.
- [ ] Kiểm tra `AppError` và các mã lỗi mới theo quy ước project, đồng bộ OpenAPI nếu response thay đổi.

**Gate:** Test API âm tính pass sau khi endpoint Workspace/Board thật tồn tại; task này có thể hoàn tất cùng plan 02/Board, không cần tạo endpoint giả.

## Review focus

1. Owner có quyền Board ngay cả khi không có BoardMembership; PM không có quyền Board khác.
2. Xóa BoardMembership hoặc WorkspaceMembership thu hồi quyền của access token đang còn hạn.
3. URL parent hợp lệ nhưng `listId/cardId` thuộc Board khác không bị lọt qua validation.
4. Archive/frozen chặn write nhưng không xóa dữ liệu và không vô hiệu hóa read hợp lệ.
5. Hai request chuyển Owner/PM đồng thời không tạo trạng thái commit với 0 hoặc 2 người giữ vai trò.

## Verification khi plan được thực thi

Chạy test mới tương ứng, sau đó `pnpm db:validate`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`. Test DB cần PostgreSQL test riêng; không chạy migration phá dữ liệu demo hoặc production. Ghi kết quả thực tế, không đánh dấu đã pass từ bản plan.

## Không thuộc plan này

AUTH login/refresh transport, Board CRUD/PM transfer, Card và AI/realtime. Board PM invariant đã chuẩn bị ở schema nhưng nghiệp vụ chuyển PM nằm trong kế hoạch Board sau này.
