# Workspace Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện mọi flow REST ở phạm vi Workspace: quản lý Workspace, lời mời và vòng đời thành viên, với phân quyền, transaction và contract khớp code.

**Architecture:** Giữ module `src/modules/workspaces` và access service dùng chung. PostgreSQL giữ Workspace, membership và trạng thái invitation; Redis giữ tra cứu token mời với TTL 7 ngày; email đi qua `sendEmail` hiện có. Mỗi thao tác nghiệp vụ kiểm quyền tại service, controller chỉ chuyển HTTP. Board API và realtime thuộc nhóm khác.

**Tech Stack:** Express 5, TypeScript, Zod, Prisma/PostgreSQL, Redis, Nodemailer adapter hiện có, Node test runner qua `tsx`.

**Implementation status (2026-10-07):** CRUD, archive/restore, paginated workspace/member lists, Owner transfer, member remove/leave, and the invitation lifecycle are implemented. Workspace metadata changes, Owner transfer, and member remove/leave recheck permissions and state inside serializable transactions. OpenAPI source is split under `docs/api/openapi/`. The Workspace integration suite passes 17/17 tests; typecheck still reports unresolved Prisma Client and Express typings in the local dependency setup. BullMQ and Socket.IO stay deferred as documented below.

**Spec:** [Business rules](../business-rules.md), [quyết định hoãn hạ tầng](../deferred-infrastructure.md), [API contract](../../api/openapi/), [endpoint matrix](../../api/endpoint-matrix.md), SRS UC-WS-06/07/08.

## Global Constraints

- Workspace role chỉ có `OWNER | MEMBER`; mỗi Workspace phải có đúng một Owner. Board role `PM | MEMBER` là phạm vi riêng.
- Chỉ người nhận đúng email mới nhận lời mời; nhận lời mời tạo WorkspaceMembership, không tự tạo BoardMembership.
- Token lời mời tồn tại tối đa **7 ngày**, raw token chỉ có trong email, không ghi log/response/DB.
- AUTH đang gửi mail trực tiếp. Workspace dùng cùng adapter; **BullMQ và Socket.IO làm sau**. Không dùng lời hứa “queued” trong API hiện tại.
- Giữ tên theo [naming conventions](../naming-conventions.md); HTTP path có prefix `/api/v1/workspaces`.
- Không xóa Card, Comment, Attachment hay lịch sử khi thành viên rời/bị gỡ. Member đang giữ PM phải chuyển PM trước.
- Chỉ sửa schema/API contract cùng lúc với task sở hữu thay đổi; không âm thầm đổi AUTH hoặc Board CRUD.

## Hiện trạng đã có

Workspace routes gồm create/list/get/update/archive/restore, quản lý thành viên và toàn bộ vòng đời invitation. `domainCategory`, page/limit, kiểm tra tài khoản đích khi chuyển Owner, chặn gỡ/rời khi còn giữ PM, thu hồi Board access/assignment, và transaction serializable đã được bổ sung. Membership hiện bị hard-delete sau khi thu hồi quyền; nội dung và lịch sử dự án được giữ lại. Bảng kiểm tra chi tiết bên dưới ghi rõ các bước xác minh còn mở.

## Bản đồ file

| Trách nhiệm                  | File chính                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model, migration, constraint | `prisma/schema.prisma`, `prisma/migrations/<new>/migration.sql`                                                                                                                            |
| HTTP và validation           | `src/modules/workspaces/routes/index.ts`, `controllers/workspace.controller.ts`, `dto/workspace.schema.ts`; tách `invitation.*` và `membership.*` khi flow mới làm file hiện tại quá lớn   |
| Nghiệp vụ và persistence     | `services/workspace.service.ts`, `repository/workspace.repository.ts`; thêm `services/invitation.service.ts`, `repository/invitation.repository.ts`, `repository/membership.repository.ts` |
| Token/email và quyền         | `src/modules/auth/utils/token.util.ts` nếu tái dùng được, `src/infrastructure/email/email.client.ts`, `src/shared/authorization/access.service.ts`                                         |
| Contract và test             | `docs/api/openapi/`, `docs/api/endpoint-matrix.md`, `tests/workspaces/*.integration.test.ts`                                                                                               |

## Contract REST đích

| Method          | Path sau `/api/v1/workspaces`                              | Flow                                   |
| --------------- | ---------------------------------------------------------- | -------------------------------------- |
| `POST` / `GET`  | `/`                                                        | Tạo / liệt kê Workspace của tôi        |
| `GET` / `PATCH` | `/:id`                                                     | Xem / cập nhật Workspace               |
| `PATCH`         | `/:id/archive`, `/:id/unarchive`                           | Archive / restore                      |
| `GET`           | `/:id/members`                                             | Liệt kê thành viên có phân trang       |
| `PATCH`         | `/:id/members/:userId`                                     | Chuyển Owner với `{ "role": "OWNER" }` |
| `DELETE`        | `/:id/members/:userId`                                     | Gỡ thành viên                          |
| `POST`          | `/:id/leave`                                               | Tự rời Workspace                       |
| `POST` / `GET`  | `/:id/invitations`                                         | Mời / xem lời mời đang chờ (Owner)     |
| `POST`          | `/invitations/:token/accept`, `/invitations/:token/reject` | Nhận / từ chối lời mời (đăng nhập)     |
| `POST`          | `/invitations/:id/resend`                                  | Gửi lại lời mời (Owner)                |
| `DELETE`        | `/:id/invitations/:invitationId`                           | Hủy lời mời (Owner)                    |

Các route bổ sung cần được ghi vào OpenAPI và endpoint matrix cùng task triển khai. Route tĩnh `/invitations/...` phải đứng trước `/:id` để tránh bắt nhầm. `PATCH members` chỉ dùng chuyển Owner, không nhận role `MANAGER` vốn không tồn tại ở Workspace. Chốt shape pagination theo `page`/`limit` và envelope chung trước khi đổi response đang trả array; ghi rõ thay đổi contract cho frontend.

## Review Focus

1. Hai request chuyển Owner đồng thời: DB luôn còn đúng một Owner; task 2 có test concurrency.
2. Resend trong lúc accept token cũ: chỉ một trạng thái thắng; task 4 có test transaction/race.
3. Mail gửi lỗi hoặc Redis lỗi: không có lời mời/token mới có thể accept; task 3 và 4 có test fake sender/failure.
4. Người bị gỡ là PM trên một hay nhiều Board: từ chối cho đến khi PM được chuyển; task 5 có test nhiều Board.
5. Workspace archive/frozen hoặc account locked: không thể tạo/gửi lại lời mời hay thay đổi thành viên; task 3–5 có test quyền và trạng thái.

---

### Task 1: Chốt schema và contract Workspace còn thiếu

**Files:** `prisma/schema.prisma`, migration mới, `src/modules/workspaces/dto/workspace.schema.ts`, `docs/api/openapi/`, `docs/api/endpoint-matrix.md`, `tests/workspaces/workspace-http.integration.test.ts`.

**Interfaces:** Giữ `createWorkspace`, `listWorkspaces`, `getWorkspace`, `updateWorkspace`, `archiveWorkspace`, `restoreWorkspace`; thêm `domainCategory`/tên field lĩnh vực theo contract cuối cùng, `page`/`limit` cho list nếu cần.

- [ ] Viết test HTTP fail cho create/update field lĩnh vực, validate UUID/body rỗng, pagination list chỉ trả Workspace đang tham gia, `401/403/404` đúng scope.
- [ ] Chạy test mục tiêu để xác nhận fail; thêm schema/migration/DTO và cập nhật service/repository tối thiểu; giữ tạo Workspace + Owner trong một transaction.
- [ ] Test archive làm Board con chỉ đọc theo quyền cha, restore Workspace không tự restore Board đã archive riêng, frozen chặn mutation; chạy test mục tiêu và typecheck.
- [ ] Đồng bộ OpenAPI/endpoint matrix cho route đã có và response thật; chạy Prisma validate/generate, migration trên DB test, test mục tiêu; commit riêng.

**Gate:** CRUD/archive/restore đúng quyền và contract, không có Workspace thiếu Owner.

### Task 2: Cứng hóa membership và chuyển Owner

**Files:** `src/modules/workspaces/services/workspace.service.ts`, `repository/membership.repository.ts` nếu tách, `src/shared/authorization/access.service.ts`, migration/index nếu cần, `tests/workspaces/ownership.integration.test.ts`.

**Interfaces:** `listWorkspaceMembers(userId, workspaceId, query)`, `transferWorkspaceOwner(actorId, workspaceId, targetUserId)`.

- [ ] Viết test fail: target không thuộc Workspace/đã khóa, actor không phải Owner, chuyển cho chính mình, hai request transfer đồng thời, list member có `page`/`limit` ổn định.
- [ ] Chạy test mục tiêu để xác nhận fail; triển khai transaction với khóa Workspace hoặc isolation `Serializable` và retry giới hạn; giữ unique partial index Owner hiện có làm chốt DB.
- [ ] Chạy test race nhiều lần; xác minh đúng một Owner sau thành công/lỗi, response/contract `PATCH` chỉ nhận `{ "role": "OWNER" }`; commit riêng.

**Gate:** Không thể có 0 hoặc 2 Owner sau request đồng thời.

### Task 3: Tạo lời mời và gửi email trực tiếp

**Files:** `prisma/schema.prisma`, migration mới, `src/modules/workspaces/dto/invitation.schema.ts`, `repository/invitation.repository.ts`, `services/invitation.service.ts`, `controllers/invitation.controller.ts`, `routes/index.ts`, `tests/workspaces/invitation-create.integration.test.ts`.

**Interfaces:** `inviteWorkspaceMember(actorId, workspaceId, email)`, `listWorkspaceInvitations(actorId, workspaceId, query)`; dependency gửi mail có thể inject `typeof sendEmail` để test không gửi mail thật.

- [ ] Viết test fail cho chỉ Owner được mời/xem, Workspace archive/frozen, email normalize, email đã là member, lời mời pending trùng, email không được cấu hình/gửi lỗi, token không lộ trong API/log.
- [ ] Chạy test mục tiêu để xác nhận fail; thêm `WorkspaceInvitation` với workspace/email/inviter/status/expiry/delivery state/timestamps, unique/index phục vụ pending. Token ngẫu nhiên chỉ gửi qua mail; Redis giữ token hash/lookup với TTL **7 ngày**.
- [ ] Gửi qua email adapter trực tiếp. Chỉ đánh dấu invitation có thể accept sau khi mail gửi thành công; khi Redis/mail lỗi, thu hồi token mới và ghi trạng thái thất bại để có thể retry, không trả `201` giả. Không đưa network call vào DB transaction dài.
- [ ] Chạy test DB/Redis với fake mailer, cập nhật API contract và kiểm tra response không chứa token/hash; commit riêng.

**Gate:** Mail thất bại không cấp một lời mời có thể accept; thành công có token 7 ngày gửi tới đúng email.

### Task 4: Accept, reject, resend và cancel invitation

**Files:** `src/modules/workspaces/{services,repository,controllers,dto}/invitation.*`, `routes/index.ts`, `docs/api/openapi/`, `docs/api/endpoint-matrix.md`, `tests/workspaces/invitation-lifecycle.integration.test.ts`.

**Interfaces:** `acceptWorkspaceInvitation(userId, rawToken)`, `rejectWorkspaceInvitation(userId, rawToken)`, `resendWorkspaceInvitation(actorId, invitationId)`, `cancelWorkspaceInvitation(actorId, workspaceId, invitationId)`.

- [ ] Viết test fail cho token sai/hết hạn/dùng lại, email user không khớp, user locked, invitation đã reject/cancel, Workspace archive/frozen, accept hai lần đồng thời.
- [ ] Chạy test mục tiêu để xác nhận fail; triển khai accept/reject bằng chuyển status có điều kiện trong transaction; accept tạo `WorkspaceMembership(MEMBER)` đúng một lần, không cấp BoardMembership.
- [ ] Viết test fail cho resend/cancel: chỉ Owner, token cũ hết hiệu lực sau resend thành công, email lỗi không kích hoạt token mới, accept đồng thời với resend không tạo trạng thái mâu thuẫn.
- [ ] Triển khai resend/cancel với version/status có điều kiện và thu hồi token Redis. Nếu email đã gửi nhưng bước commit sau đó lỗi, báo lỗi và lưu trạng thái cho phép gửi lại; link lỗi không được accept. Cập nhật contract, chạy test; commit riêng.

**Gate:** Token một lần, không vượt 7 ngày; invitation state và membership khớp nhau kể cả request đồng thời.

### Task 5: Remove member và leave Workspace an toàn

**Files:** `src/modules/workspaces/services/workspace.service.ts`, `repository/membership.repository.ts` nếu tách, `src/shared/authorization/access.service.ts`, migration nếu chọn marker inactive, `tests/workspaces/member-lifecycle.integration.test.ts`, API contract.

**Interfaces:** `removeWorkspaceMember(actorId, workspaceId, targetUserId)`, `leaveWorkspace(userId, workspaceId)`.

- [ ] Viết test fail cho Owner tự rời/xóa mình, non-Owner xóa người khác, target không thuộc Workspace, member đang là PM trên nhiều Board, concurrent remove/transfer.
- [ ] Chạy test mục tiêu để xác nhận fail; trong transaction kiểm tra PM rồi thu hồi BoardMembership và CardAssignment thuộc Workspace, vô hiệu WorkspaceMembership; giữ Card/Comment/Attachment và tác giả. Chọn marker inactive hoặc hard-delete membership sau khi kiểm tra yêu cầu lịch sử, rồi đồng bộ guard/list/unique constraint theo lựa chọn đó.
- [ ] Test access token còn hạn mất quyền ngay sau remove/leave; tham gia lại không tự khôi phục quyền Board/assignment; rollback sạch khi một bước thất bại. Cập nhật docs contract; commit riêng.

**Gate:** Không thể bỏ Board thiếu PM; người rời/bị gỡ mất mọi quyền hiện hành nhưng lịch sử còn nguyên.

### Task 6: Kiểm tra tích hợp và khép contract

**Files:** `tests/workspaces/*.integration.test.ts`, `docs/api/openapi/`, `docs/api/endpoint-matrix.md`, `docs/CORE/README.md`.

- [ ] Viết test HTTP end-to-end cho create → invite → accept → list → transfer Owner → remove/leave và các trường hợp `401/403/404/409/410`; dùng fake mailer, DB/Redis test riêng.
- [ ] Chạy `pnpm db:validate`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`; sửa lỗi phát sinh, ghi kết quả thực tế.
- [ ] Rà OpenAPI so với route/service, xác minh không còn `MANAGER`, “queued”, route thiếu hoặc response giả; commit phần còn lại.

**Gate:** Toàn bộ Workspace REST flow và kiểm thử chạy qua; danh sách phần hoãn vẫn nêu BullMQ/Socket.IO và khoảng cách SRS tương ứng.

## Thứ tự thực hiện

Task 1 → 2 → 3 → 4 → 5 → 6. Sau Task 2, phần test/schema của Task 5 có thể chuẩn bị song song với Task 3, nhưng migration, router và shared authorization chỉ có một người tích hợp tại một thời điểm. Mỗi task có commit và review riêng. Không tính Board CRUD, Board PM transfer, Socket.IO hay BullMQ vào phạm vi hoàn tất của plan này.
