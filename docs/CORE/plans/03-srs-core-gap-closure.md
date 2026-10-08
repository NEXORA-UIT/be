# Kế hoạch khép các khoảng trống REST Core so với SRS

> **Dành cho người thực thi:** Dùng `superpowers:executing-plans` để làm từng task theo thứ tự; đánh dấu ô kiểm sau khi có kết quả kiểm thử. Nếu chia agent, dùng `superpowers:subagent-driven-development` và chỉ giao các task không cùng sửa schema hoặc quyền dùng chung.

**Mục tiêu:** Khép các sai khác REST Core đã xác nhận trong lần đối chiếu SRS ngày 2026-10-08, trên nền ba nhánh `feature/core-board-list`, `feature/core-card` và `feature/core-rest-completion`.

**Kiến trúc:** Giữ modular monolith, Prisma/PostgreSQL làm nguồn sự thật cho tư cách thành viên và nhật ký; quyền đọc và quyền ghi có guard riêng. Dữ liệu tổng hợp được tính từ Task/List/Card lúc đọc; lưu trữ tệp đi qua `ObjectStorage` để có thể chọn filesystem trong test và R2 khi triển khai.

**Công nghệ:** Express 5, TypeScript, Zod, Prisma/PostgreSQL, Redis hiện có, Node test runner qua `tsx`, OpenAPI chia theo module; `@aws-sdk/client-s3` cho adapter R2.

**Đặc tả:** SRS mục 2.4.2–2.4.10, 2.5.1, UC-WS-07, UC-Board-09, UC-Card-12, UC-COL-16/17, UC-PLAN-01/03/04; [quy tắc nghiệp vụ](../business-rules.md), [phạm vi ba nhánh đã triển khai](../implementation-order.md), [hợp đồng API](../../api/README.md). SRS PDF là tài liệu nguồn bên ngoài repo; không sao chép PDF vào đây.

## Ranh giới và thứ tự nhánh

| Nhánh đề xuất                        | Nền                            | Phạm vi                                                                                  | Cổng trước khi sang nhánh sau                                                    |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `feature/core-srs-membership-audit`  | `feature/core-rest-completion` | Membership ngừng hiệu lực/tái gia nhập, nhật ký chuyển Owner/PM, nguồn gốc `appointedBy` | Quyền bị thu hồi ngay; đúng một Owner/PM; lịch sử không bị gán sai người         |
| `feature/core-srs-archive-storage`   | Nhánh 1                        | Quyền đọc/ghi khi archive hoặc frozen; R2 cho Card Attachment và xóa Board               | Dữ liệu archive đọc được nhưng không sửa được; kiểm thử storage lỗi và retry đạt |
| `feature/core-srs-planning-contract` | Nhánh 2                        | Tiến độ Task, dữ liệu Calendar/List View/Dashboard, cảnh báo dependency và OpenAPI       | Kết quả REST đủ trường SRS; toàn bộ test và kiểm tra hợp đồng đạt                |

Chỉ một nhánh sở hữu `prisma/schema.prisma`, migration và quyền dùng chung tại một thời điểm. Mỗi task cập nhật OpenAPI ngay khi đổi response. Không sửa lại migration đã được áp dụng; mọi thay đổi dữ liệu dùng migration mới, có kiểm tra dữ liệu cũ và đường quay lui.

Giữ route và `operationId` hiện có; trường response mới là thay đổi bổ sung. Viết tài liệu mới bằng tiếng Việt, giữ tên model/field/route đúng code. Test integration dùng PostgreSQL và Redis Docker cục bộ, không dùng tài khoản R2 thật trong bộ test.

BullMQ, Socket.IO, AI, RAG, Agent và pipeline Knowledge Base vẫn theo [quyết định hoãn](../deferred-infrastructure.md) và [phạm vi Core](../README.md). Vì vậy hoàn thành kế hoạch này chỉ xác nhận **REST Core trong phạm vi đã chọn**, không xác nhận toàn bộ SRS. UC-Board-09 còn bước xóa tài liệu Knowledge Base khi module Document được triển khai; phải giữ mục đó là chưa đạt trong bảng truy vết.

## Điểm cần soi kỹ khi review

1. Token cũ của thành viên đã bị gỡ không còn đọc được Board; nhận lời mời lại không tự khôi phục BoardMembership hay CardAssignment.
2. Hai request chuyển Owner hoặc PM đồng thời vẫn để lại đúng một người giữ vai trò, và sự kiện audit chỉ ghi khi transaction thành công.
3. Card/List/Board/Workspace đã archive hoặc frozen cho phép người có quyền đọc dữ liệu lịch sử, nhưng từ chối mọi thao tác ghi, kể cả xóa tệp.
4. Tệp đã ghi lên R2 nhưng DB lỗi, hoặc xóa Board gặp lỗi R2, có trạng thái retry xác định; không trả thành công giả.
5. Card không có Task, không có dueDate, thuộc Done, hoặc có dependency thiếu mốc thời gian đều có kết quả tiến độ/cảnh báo xác định.

## Bản đồ file

| Trách nhiệm                        | File sở hữu chính                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tư cách thành viên và audit        | `prisma/schema.prisma`, migration mới, `src/modules/workspaces/`, `src/modules/boards/services/board.service.ts`                             |
| Kiểm tra quyền và vòng đời archive | `src/shared/authorization/`, `src/modules/collaboration/services/collaboration.service.ts`, `src/modules/cards/child-resources/service.ts`   |
| Tệp và cleanup                     | `src/infrastructure/storage/`, `src/modules/boards/services/board.service.ts`, `src/modules/collaboration/services/collaboration.service.ts` |
| Tiến độ và planning                | `src/modules/cards/`, `src/modules/planning/read-models/`                                                                                    |
| Hợp đồng và kiểm thử               | `docs/api/openapi/`, `docs/api/endpoint-matrix.md`, `tests/` theo module                                                                     |

---

## Nhánh 1 — Membership và truy vết quyền

### Task 1: Ngừng hiệu lực WorkspaceMembership thay vì xóa hàng

**File:** `prisma/schema.prisma`, migration mới, `src/modules/workspaces/services/workspace.service.ts`, `src/modules/workspaces/services/invitation.service.ts`, `src/modules/workspaces/repository/workspace.repository.ts`, `src/shared/authorization/access.service.ts`, `src/shared/authorization/access-transaction.service.ts`, các service đang truy vấn WorkspaceMembership; test trong `tests/workspaces/` và `tests/core/`.

**Giao diện:** Thêm `WorkspaceMembership.endedAt: DateTime?`; `endedAt = null` là membership hiện hành. Giữ unique `(workspaceId, userId)`; khi nhận lời mời sau khi rời, tái kích hoạt cùng hàng với `role = MEMBER`, `endedAt = null`, không tái tạo BoardMembership/assignment. Nhật ký ở Task 2 ghi từng lần rời và tái gia nhập.

- [x] Viết integration test đang fail: Owner chuyển quyền rồi rời; member bị gỡ/rời mất quyền ngay với access token còn hạn; hàng membership vẫn còn với `endedAt`; tái gia nhập bằng lời mời hợp lệ có quyền Workspace nhưng không có lại quyền Board/assignment cũ; hai lần accept không tạo hai membership.
- [x] Chạy riêng các test mới, xác nhận chúng fail do hàng bị xóa hoặc quyền cũ còn hiệu lực.
- [x] Tạo migration bổ sung `endedAt`; cập nhật mọi truy vấn membership trong `src/` để chỉ xem hàng hiện hành. `removeMemberFromWorkspace` đánh dấu kết thúc trong cùng transaction với thu hồi BoardMembership và assignment; `acceptWorkspaceInvitation` tái kích hoạt hàng cũ có điều kiện.
- [x] Chạy test Workspace, Board/Card authorization và invitation; kiểm tra migration trên DB có membership cũ; commit riêng.

**Nghiệm thu:** Không còn thao tác hard-delete WorkspaceMembership khi rời/gỡ; lịch sử nội dung và tác giả giữ nguyên, quyền cũ bị thu hồi ngay.

### Task 2: Ghi nhật ký chuyển Owner/PM và sửa cách trình bày `appointedBy`

**File:** `prisma/schema.prisma`, migration mới, `src/modules/workspaces/services/workspace.service.ts`, `src/modules/workspaces/services/invitation.service.ts`, `src/modules/workspaces/services/workspace-audit.service.ts` (mới), `src/modules/boards/services/board.service.ts`, `tests/workspaces/workspace-lifecycle.integration.test.ts`, `tests/boards/board-list.integration.test.ts`, OpenAPI phần Workspace/Board.

**Giao diện:** Tạo `WorkspaceAuditLog` bất biến với `workspaceId`, `actorId`, `targetUserId`, `action`, `details`, `createdAt`; ghi `OWNER_TRANSFERRED`, `MEMBER_REMOVED`, `MEMBER_LEFT`, `MEMBER_REJOINED` trong cùng transaction với mutation. Chuyển PM ghi thêm `ActivityLog` action `BOARD_PM_TRANSFERRED` với actor, PM cũ và PM mới. Thêm `BoardMembership.appointmentProvenance = UNKNOWN | RECORDED`; mọi hàng có trước migration mới là `UNKNOWN`, thao tác phân công mới đặt `RECORDED`. Chỉ hiển thị `appointedBy` như người bổ nhiệm đã xác minh khi provenance là `RECORDED`.

- [ ] Viết test đang fail: chuyển Owner/PM thành công có đúng một audit event với actor và vai trò cũ/mới; transaction rollback hoặc request đua thất bại không ghi event; gỡ/rời/tái gia nhập giữ vết sự kiện.
- [ ] Chạy test mục tiêu để xác nhận fail; thêm model/migration và hàm ghi audit. Không viết lại migration Board/List đã áp dụng và không đoán người bổ nhiệm lịch sử từ Owner hiện tại.
- [ ] Migration đánh dấu các hàng PM hiện có là `UNKNOWN`; code tạo/chuyển PM mới đặt `RECORDED`. Không suy diễn lại lịch sử cũ bằng timestamp; cập nhật response nếu có xuất `appointedBy`.
- [ ] Chạy lại test race Owner/PM và migration trên dữ liệu mẫu; commit riêng.

**Nghiệm thu:** Truy vết đúng các thao tác mới; dữ liệu cũ không bị trình bày như một sự kiện bổ nhiệm đã được chứng minh.

## Nhánh 2 — Archive và lưu trữ tệp

### Task 3: Thống nhất quyền đọc và ghi trong vòng đời archive/frozen

**File:** `src/modules/collaboration/services/collaboration.service.ts`, `src/modules/cards/child-resources/service.ts`, guard dùng chung nếu cần, `tests/collaboration/collaboration.integration.test.ts`, `tests/cards/card-child-resources.integration.test.ts`, OpenAPI Card/Collaboration.

**Giao diện:** Guard đọc yêu cầu membership hiện hành nhưng chấp nhận cha hoặc Card đã archive/frozen; Card đã soft-delete vẫn trả 404. Guard ghi yêu cầu Card, List, Board, Workspace hoạt động và Workspace không frozen. Dùng cùng quy tắc cho comment, Task, attachment và activity.

- [ ] Viết test đang fail: người có quyền đọc comment/Task/activity/attachment sau khi Card hoặc cha archive/frozen; người ngoài Board vẫn bị 403; Card soft-delete vẫn 404; xóa attachment của Card/List đã archive hoặc Workspace frozen bị từ chối và object còn nguyên.
- [ ] Chạy test mục tiêu, sau đó thay `activeCard`/`requireActiveBoardAccess` ở read path bằng guard đọc. `deleteCardAttachment` phải kiểm tra trạng thái Card/List/cha trước khi gọi `storage.delete`; kiểm tra lại quyền và trạng thái gần thời điểm ghi để giảm cửa sổ thu hồi quyền.
- [ ] Chạy test Card/Board/Collaboration và kiểm tra OpenAPI mô tả đúng hành vi archive; commit riêng.

**Nghiệm thu:** Archive/frozen nhất quán là chỉ đọc trên mọi tài nguyên Core; không có đường xóa tệp thuộc Card đã archive.

### Task 4: Chọn R2 cho môi trường triển khai và giữ cleanup có thể retry

**File:** `src/infrastructure/storage/object-storage.ts`, `src/infrastructure/storage/r2-object-storage.ts` (mới), `src/modules/collaboration/services/collaboration.service.ts`, `src/modules/boards/services/board.service.ts`, `package.json`, `pnpm-lock.yaml`, cấu hình môi trường mẫu/README triển khai, `tests/collaboration/collaboration.integration.test.ts`, `tests/boards/board-list.integration.test.ts`.

**Giao diện:** Giữ `ObjectStorage.put/get/delete`; `R2ObjectStorage` dùng `@aws-sdk/client-s3`. `ATTACHMENT_STORAGE_PROVIDER=filesystem|r2` chọn provider; R2 yêu cầu `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` và dùng region `auto`. Production yêu cầu `r2` và fail sớm nếu thiếu cấu hình; filesystem chỉ dùng cho local/test. `deleteArchivedBoard` nhận `ObjectStorage` tùy chọn để test lỗi bằng fake storage. Không đổi route hoặc ID attachment.

- [ ] Viết test provider bằng fake S3 client: put/get/delete, thiếu cấu hình, lỗi upload, lỗi xóa, gọi delete lặp; test Board delete giữ DB rows khi cleanup tệp thất bại và retry thành công khi storage hoạt động lại.
- [ ] Chạy test mục tiêu để xác nhận fail; triển khai R2 adapter và cấu hình. Không đưa credentials vào repo hoặc log. Giữ `PendingObjectCleanup` cho object đã upload nhưng DB ghi thất bại.
- [ ] Xác định đường di chuyển blob filesystem đã tồn tại trước khi bật R2; nếu không có dữ liệu production, ghi rõ điều kiện đó trong tài liệu triển khai. Không đổi provider khi các attachment cũ chưa đọc được ở provider mới.
- [ ] Chạy test Collaboration/Board, xác minh upload/download qua fake storage và cleanup lỗi; commit riêng.

**Nghiệm thu:** Card Attachment và Board delete dùng đúng provider đã cấu hình, lỗi storage không báo thành công giả. Tác vụ xóa Document Knowledge Base của UC-Board-09 vẫn là dependency của module Knowledge Base, chưa đánh dấu hoàn tất.

## Nhánh 3 — Tiến độ và dữ liệu planning

### Task 5: Trả tiến độ Task nhất quán cho Card

**File:** `src/modules/cards/repository/card.repository.ts`, `src/modules/cards/services/card.service.ts`, `src/modules/cards/child-resources/service.ts`, `docs/api/openapi/components/cards.yaml`, `tests/cards/card-core.integration.test.ts`, `tests/cards/card-child-resources.integration.test.ts`.

**Giao diện:** `taskProgress = { total: number, completed: number, percent: number }`; `percent = 0` nếu `total = 0`, còn lại là `Math.round(completed / total * 100)`. Tính từ Task hiện hành khi đọc Card, không lưu một bản sao dễ lệch trong Card. Hoàn tất Task không tự chuyển Card sang Done.

- [ ] Viết test đang fail cho 0/1/n Task, hoàn tất rồi mở lại, xóa Task, hai request cập nhật cạnh tranh và Card thuộc Done vẫn giữ trạng thái từ List.
- [ ] Chạy test mục tiêu; bổ sung truy vấn đếm theo Card dạng batch cho list Board để tránh một query mỗi Card, thêm trường vào Card detail/list response và OpenAPI.
- [ ] Chạy test Card/Task và xác minh response trên route thật; commit riêng.

**Nghiệm thu:** Tiến độ trả về đúng ngay sau mọi thay đổi Task, không tạo Card status độc lập.

### Task 6: Hoàn thiện Calendar, List View và Dashboard theo UC-PLAN-01/03/04

**File:** `src/modules/planning/read-models/read-model.repository.ts`, `read-model.service.ts`, `read-model.schema.ts`, `src/modules/planning/dependencies/dependency.service.ts` nếu cần hàm đọc tổng hợp, `docs/api/openapi/planning.yaml`, `docs/api/openapi/components/planning.yaml`, `docs/api/openapi/components/boards.yaml`, `tests/planning/read-models.integration.test.ts`, `tests/planning/dependencies.integration.test.ts`.

**Giao diện:** Calendar/List View trả `assigneeIds`, `statusGroup`, `isOverdue` cùng List, ngày và priority. `isOverdue` chỉ đúng khi có `dueDate < now`, Card/List/Board/Workspace đang hoạt động và trạng thái khác DONE. Dashboard trả thêm `completionPercent = 0` nếu Board trống, nếu không là `Math.round(done / totalCards * 100)`. Calendar trả `dependencyWarnings: { prerequisiteCardId, kind: 'SCHEDULE_CONFLICT' }[]`; thêm cảnh báo khi prerequisite chưa DONE và `dueDate` của nó muộn hơn `startDate` của Card phụ thuộc. Thiếu một trong hai mốc thì không suy đoán xung đột.

- [ ] Viết test đang fail: Board khác không lộ dữ liệu; dueDate-only xuất hiện trên Calendar; Card không có ngày vẫn có trong List View; assignee/overdue đúng; Card Done hoặc archive không quá hạn; Board rỗng trả 0; lịch có và không có xung đột dependency trả kết quả xác định.
- [ ] Chạy test mục tiêu; mở rộng repository bằng truy vấn batch cho assignment/dependency, tính toán ở service theo UTC, không thêm trạng thái tiến độ lưu trong DB.
- [ ] Cập nhật OpenAPI và [bảng truy vết](../../api/endpoint-matrix.md); chạy test planning và so sánh response thật với schema; commit riêng.

**Nghiệm thu:** Các field đầu ra SRS của ba chế độ xem có mặt, đúng quyền Board và đúng dữ liệu tại thời điểm truy vấn.

### Task 7: Chốt hợp đồng và cổng tích hợp

**File:** `docs/api/openapi/collaboration.yaml`, `docs/api/endpoint-matrix.md`, `docs/CORE/implementation-order.md`, tài liệu triển khai storage và test liên quan nếu cổng phát hiện thiếu.

- [ ] Sửa mô tả quyền xóa comment trong OpenAPI cho khớp code và SRS: chỉ tác giả được xóa, trừ khi có quyết định nghiệp vụ mới kèm test. Đối chiếu mọi `operationId`, route và response đã đổi trong ba nhánh.
- [ ] Chạy `node --env-file=.env.local ./node_modules/prisma/build/index.js validate`, kiểm tra migration status và áp dụng migration mới trên DB test bằng `migrate deploy`; chạy `node ./node_modules/typescript/bin/tsc --noEmit`.
- [ ] Chạy `node --env-file-if-exists=.env.local ./node_modules/tsx/dist/cli.mjs --test-concurrency=1 --test tests/**/*.test.ts`, `node node_modules/prettier/bin/prettier.cjs --check .` và `node --import tsx --input-type=module -e "import { loadOpenApiDocument } from './src/docs/openapi-loader.ts'; loadOpenApiDocument();"`. Kiểm tra lại trực tiếp các ca audit ban đầu, không chỉ dựa vào số test pass.
- [ ] Cập nhật trạng thái tài liệu bằng kết quả mới; ghi rõ UC-Board-09 Knowledge Base, BullMQ, Socket.IO, AI/RAG/Agent còn ngoài phạm vi; commit docs riêng.

**Nghiệm thu cuối:** Không còn các sai khác REST Core liệt kê trong audit; test và migration đạt trên PostgreSQL/Redis Docker; tài liệu không tuyên bố đáp ứng toàn bộ SRS khi các module hoãn vẫn thiếu.
