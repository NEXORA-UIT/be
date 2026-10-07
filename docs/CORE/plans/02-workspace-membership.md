# Workspace và Membership — Implementation Plan

> **For implementers:** Hoàn thành contract/schema và các helper authorization trong [plan 01](01-authorization.md) trước khi nối route. Viết test nghiệp vụ/quyền trước từng luồng, review sau mỗi task.

**Goal:** Người dùng tạo/quản lý Workspace theo vai trò Owner, mời thành viên, chuyển Owner và rời/xóa thành viên mà vẫn giữ đúng một Owner và không mất lịch sử dự án.

**Architecture:** Module `workspaces` sở hữu routes/controllers/DTO/services/repository. Mỗi service gọi access service của plan 01. PostgreSQL giữ business state và transaction; Redis giữ token lời mời ngắn hạn; BullMQ xử lý email mời. AUTH chỉ cung cấp `request.auth.userId`, không bị sửa trong plan này.

**Tech stack:** Express 5, TypeScript strict, Prisma/PostgreSQL, Redis, BullMQ cho email, Zod, `tsx --test`.

**Spec:** [Business rules](../business-rules.md), [initial audit](../initial-audit.md), SRS PDF mục 2.4.2, 2.4.6–2.4.7, 2.5.4, UC-WS-08/06/07, trang PDF 21–24, 29, 48–53; [API contract](../../api/openapi.yaml).

## Phụ thuộc từ plan 01

Sử dụng `requireWorkspaceAccess`, `requireWorkspaceOwner`, `requireWorkspaceWriteAccess` và các role/model đã chốt. Workspace plan **không** tự tạo bộ role/policy thứ hai. Trước khi thêm Board service, plan này có thể triển khai chức năng remove/leave với truy vấn BoardMembership nếu model Board đã sẵn; hoạt động phải được test trên Workspace có nhiều Board.

## API contract cần đối chiếu trước code

Giữ endpoint hiện có trong OpenAPI: `POST/GET /workspaces`, `GET/PATCH /workspaces/{id}`, `PATCH /workspaces/{id}/archive`, invitations create/accept/resend, `GET /workspaces/{id}/members`, `PATCH/DELETE /workspaces/{id}/members/{userId}`.

Đề xuất bổ sung contract rõ ràng cho `PATCH /workspaces/{id}/unarchive`, `POST /workspaces/{id}/leave`, `POST /workspaces/invitations/{token}/reject` và `GET /workspaces/{id}/invitations` nếu giao diện cần danh sách lời mời đang chờ. Endpoint role update hiện có chỉ cho phép **chuyển Owner nguyên tử** bằng `role: OWNER`; không hỗ trợ `role: MEMBER` độc lập vì có thể bỏ Workspace không có Owner. Nếu frontend đã dùng endpoint khác, chốt contract với frontend trước khi thay đổi đường dẫn. Không trả token mời hoặc token hash trong danh sách/response quản trị.

## Task 1 — Hoàn thiện schema Workspace và invitation

**Files:** `prisma/schema.prisma`; migration mới trong `prisma/migrations/`; `tests/workspaces/schema.integration.test.ts`.

- [ ] Viết test constraint membership unique, chỉ `OWNER/MEMBER`, một Owner tối đa, invitation status/lifetime, quan hệ với Workspace/User. Kiểm tra migration không tác động bảng AUTH.
- [ ] Hoàn thiện field Workspace từ API contract/SRS (`name`, `description`, lĩnh vực, `archivedAt`, timestamps; trạng thái frozen đã chốt ở plan 01), soft-delete marker cho membership theo UC-WS-07 hoặc cơ chế active flag thống nhất. `WorkspaceInvitation` có `workspaceId`, email chuẩn hóa, người mời, business status `PENDING/ACCEPTED/REJECTED/EXPIRED`, expiry và timestamps; raw token không lưu PostgreSQL.
- [ ] Chốt `onDelete` để không cascade xóa Card/Comment/Activity khi membership bị gỡ. Thêm index cho `workspaceId`, email/status/expiry theo truy vấn thật.
- [ ] Chạy Prisma validate/generate và áp dụng migration trên DB test. Nếu có dữ liệu cũ, migration phải có đường đi không mất dữ liệu.

**Gate:** Schema hỗ trợ giữ lịch sử và business state invitation bền vững.

## Task 2 — Tạo, đọc, cập nhật và archive/restore Workspace

**Files:** `src/modules/workspaces/dto/workspace.schema.ts`, `repository/workspace.repository.ts`, `services/workspace.service.ts`, `controllers/workspace.controller.ts`, `routes/index.ts`; `tests/workspaces/workspace.integration.test.ts`.

**Interfaces:** `createWorkspace(userId, input)`, `listMyWorkspaces(userId, query)`, `getWorkspace(userId, id)`, `updateWorkspace(userId, id, input)`, `archiveWorkspace(userId, id)`, `restoreWorkspace(userId, id)`.

- [ ] Test tạo Workspace + membership OWNER trong cùng transaction, rollback khi một phần lỗi; User khác không sửa; list chỉ trả Workspace mình tham gia.
- [ ] Implement các service và API theo envelope có sẵn. Read cho member hợp lệ; update/archive/restore chỉ Owner. Archive chuyển Board con sang trạng thái **chỉ đọc theo quyền cha**, không tự gắn `archivedAt` riêng lên mọi Board nếu SRS không yêu cầu.
- [ ] Test archive chặn mutation thường; restore Workspace không tự restore Board đã archive độc lập. Chạy test và typecheck.

**Gate:** Không thể tạo Workspace hợp lệ mà thiếu Owner; trạng thái cha chi phối các Board con.

## Task 3 — Xem thành viên và chuyển Owner nguyên tử

**Files:** `src/modules/workspaces/dto/member.schema.ts`, `repository/membership.repository.ts`, `services/membership.service.ts`, `controllers/membership.controller.ts`, `routes/index.ts`; `tests/workspaces/ownership.integration.test.ts`.

**Interfaces:** `listMembers(userId, workspaceId, query)`, `transferOwner(actorId, workspaceId, targetUserId)`.

- [ ] Test Owner hiện tại chuyển cho một MEMBER active trong cùng Workspace; người khác bị 403; target ngoài Workspace/locked bị từ chối; duplicate/retry không làm có 0 hoặc 2 Owner.
- [ ] Implement transaction chuyển Owner: khóa/serialize theo Workspace (row lock hoặc isolation `Serializable` + retry có giới hạn), hạ Owner cũ về MEMBER, nâng target lên OWNER; unique partial index chặn 2 Owner. Ghi actor trong Activity/Audit khi module log đã sẵn; không tạo lịch sử giả ở client.
- [ ] Dùng endpoint `PATCH /workspaces/{id}/members/{userId}` với body `role: OWNER` sau khi cập nhật OpenAPI. Trả lỗi cho `role: MEMBER` trực tiếp hoặc mục tiêu không hợp lệ. Chạy DB integration và test quyền.

**Gate:** Sau mọi transaction thành công, Workspace vẫn đúng một Owner; lỗi giữa chừng rollback hoàn toàn.

## Task 4 — Mời, nhận, từ chối và gửi lại lời mời

**Files:** `src/modules/workspaces/dto/invitation.schema.ts`, `repository/invitation.repository.ts`, `services/invitation.service.ts`, `controllers/invitation.controller.ts`, `routes/index.ts`; `src/infrastructure/bullmq/` email producer/worker và cấu hình tối thiểu; `tests/workspaces/invitation.integration.test.ts`.

**Interfaces:** `inviteMember(actorId, workspaceId, email)`, `acceptInvitation(userId, rawToken)`, `rejectInvitation(userId, rawToken)`, `resendInvitation(actorId, invitationId)`.

- [ ] Test email đã là member, invitation PENDING trùng, email nhận không khớp User đăng nhập, token sai/hết hạn/đã dùng, concurrent accept, resend hủy token cũ. Accept tạo MEMBER và đổi invitation sang ACCEPTED trong một DB transaction; không cấp BoardMembership.
- [ ] PostgreSQL lưu invitation/status/expiry; Redis lưu token hash hoặc key tra cứu với TTL **7 ngày** theo UC-WS-06. Raw token chỉ ở email, không trả trong API/list/log. Quy định cách xử lý Redis và DB lệch trạng thái: không đánh dấu đã gửi nếu token/job chưa sẵn; có retry/compensation và thông báo lỗi rõ.
- [ ] Thêm BullMQ producer/worker gửi email mời dùng email adapter hiện có; job retry và idempotency tối thiểu. Không gửi email đồng bộ trong request, không mở rộng sang notification/realtime.
- [ ] Test worker bằng fake adapter/queue, integration PostgreSQL/Redis trên môi trường test riêng; cập nhật OpenAPI cho các endpoint thêm và error cases.

**Gate:** Lời mời hết hạn/đã dùng không tạo membership; lỗi worker không tạo trạng thái “đã gửi” giả.

## Task 5 — Xóa thành viên và rời Workspace

**Files:** `src/modules/workspaces/services/membership.service.ts`, `repository/membership.repository.ts`, `controllers/membership.controller.ts`, `routes/index.ts`; `tests/workspaces/member-lifecycle.integration.test.ts`.

**Interfaces:** `removeMember(actorId, workspaceId, targetUserId)`, `leaveWorkspace(userId, workspaceId)`.

- [ ] Test Owner không thể rời/xóa chính mình khi còn Owner; member đang là PM của bất kỳ Board nào phải chuyển PM trước; non-Owner không xóa người khác; member ngoài Workspace không bị tác động.
- [ ] Trong một transaction, thu hồi BoardMembership của mọi Board trong Workspace, gỡ CardAssignment đang hiệu lực, đánh dấu WorkspaceMembership inactive/removed; giữ Card, Comment, Attachment, Activity và thông tin tác giả. Test nhiều Board và lỗi giữa chừng rollback.
- [ ] Test access token cũ mất quyền ngay; tham gia lại không tự khôi phục BoardMembership hoặc assignment; các lời mời cũ không cấp lại quyền ngoài ý muốn.
- [ ] Đồng bộ OpenAPI cho leave và role/error behavior, chạy test tích hợp.

**Gate:** Không còn quyền hoặc phân công đang hiệu lực sau remove/leave; lịch sử vẫn truy vết được.

## Review focus

1. Owner transfer dưới hai request đồng thời và retry cùng target.
2. Member bị xóa đang PM trên nhiều Board; mọi Board vẫn có PM.
3. Invitation accept với email User khác, token cũ sau resend và token dùng lại.
4. Redis/queue lỗi sau khi DB đã tạo invitation; trạng thái API và email phải nhất quán hoặc có đường retry rõ.
5. Workspace archive/restore khi Board con đã archive độc lập.

## Verification khi plan được thực thi

Chạy test từng task và toàn bộ `pnpm test`; `pnpm db:validate`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`. Migration và tests DB/Redis/BullMQ chạy trên môi trường test tách dữ liệu demo. Repo hiện chưa có script `lint`. Báo kết quả lệnh thực tế và mọi Core gap còn lại.

## Ranh giới sau plan này

Board CRUD, chuyển PM, List/Card và AI/realtime ở nhóm sau. Plan này chỉ dùng model Board/BoardMembership để bảo vệ invariant khi thành viên rời Workspace; không tự xây Board API.
