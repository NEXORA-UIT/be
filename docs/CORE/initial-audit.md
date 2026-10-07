# Core — Rà soát ban đầu và các điểm lệch

Ngày ghi nhận: **2026-10-07**. Phạm vi: đọc SRS liên quan Core, master prompt, cấu trúc repository, schema, routes và một số luồng AUTH. Chưa audit đầy đủ từng service, chưa chạy test, build, typecheck hoặc API/database thực tế trong lượt rà soát này.

“Có mã nguồn” bên dưới không đồng nghĩa đã xác minh chạy đúng hoặc đáp ứng toàn bộ SRS.

## 1. Hiện trạng quan sát được

| Thành phần | Kết quả đọc code |
| --- | --- |
| Backend | Express 5, TypeScript strict/ESM, cấu trúc modular monolith |
| Dữ liệu | Prisma/PostgreSQL; schema hiện có User, RefreshToken, OAuthAccount |
| Migration | Có migration `20260930162541_auth_core` |
| AUTH | Có route/service cho đăng ký, xác nhận email, login, refresh, logout/logout-all, me, đổi/quên/reset mật khẩu |
| Google OAuth | Có route, controller, service, state handling và tests |
| GitHub OAuth / cập nhật profile | Tài liệu AUTH ghi là phần tiếp theo/chưa triển khai tương ứng; enum GITHUB không chứng minh flow đã có |
| Redis / email | Có client và cấu hình; AUTH có repository cache/state |
| Workspace, Board, Card | Các router đã gắn vào API nhưng file route kiểm tra vẫn rỗng; schema chưa có model Core |
| Collaboration / Planning | Các router kiểm tra vẫn rỗng; chưa có nghiệp vụ Core tương ứng trong cây source đã rà |
| Tests | Có tests AUTH và error middleware; chưa thấy bộ tests Core trong danh sách đã kiểm tra |
| API docs | Có OpenAPI, endpoint matrix, conventions và tài liệu WebSocket; đây là contract, không phải bằng chứng runtime |

## 2. Bằng chứng trong repository

- [package.json](../../package.json): dependencies và scripts.
- [Prisma schema](../../prisma/schema.prisma): ba model AUTH hiện tại.
- [Router tổng](../../src/routes/index.ts): các module đã được mount.
- [AUTH routes](../../src/modules/auth/routes/index.ts): endpoint xác thực hiện có.
- [Workspace routes](../../src/modules/workspaces/routes/index.ts), [Board routes](../../src/modules/boards/routes/index.ts), [Card routes](../../src/modules/cards/routes/index.ts): router giữ chỗ.
- [Collaboration routes](../../src/modules/collaboration/routes/index.ts), [Planning routes](../../src/modules/planning/routes/index.ts): router giữ chỗ.
- [AUTH README](../AUTH/README.md): thiết kế, trạng thái và quy ước AUTH chi tiết.

## 3. Xung đột quan trọng: Owner và PM

| Master prompt | SRS hiện tại |
| --- | --- |
| Workspace có đúng một PM | Workspace có đúng một OWNER |
| Người tạo Workspace là PM | Người tạo Workspace là Owner |
| PM truy cập mọi Board trong Workspace | Owner có quyền này; PM chỉ quản lý Board được phân công |
| Transfer PM ở Workspace | Chuyển Owner tại Workspace; phân công/chuyển PM tại Board là nghiệp vụ riêng |

Nguồn SRS: mục 2.4.2–2.4.3, 2.5.1, 2.5.4, trang 21–22, 26, 29; use case Workspace/Board trang 51–55.

Hướng xử lý đã xác định trong trao đổi: bám mô hình hai cấp của SRS. Không triển khai `requireWorkspacePM()` theo nghĩa PM toàn Workspace. Tên helper và chi tiết thiết kế sẽ được chốt khi lập kế hoạch; chưa có helper mới được tạo.

## 4. Xung đột refresh-token transport

SRS mục 4.2.1, trang 105 yêu cầu refresh token chỉ qua cookie HttpOnly + Secure + SameSite, không trả trong JSON response.

Code hiện tại:

- [token.service.ts](../../src/modules/auth/services/token.service.ts): `issueTokens()` trả `refreshToken` trong object kết quả.
- [auth.controller.ts](../../src/modules/auth/controllers/auth.controller.ts): trả object token bằng JSON; refresh lấy token từ body.
- [auth.schema.ts](../../src/modules/auth/dto/auth.schema.ts): `refreshSchema` yêu cầu trường `refreshToken` trong JSON body.

Đây là lệch contract có bằng chứng tĩnh. Chưa sửa trong bước ghi context. Khi xử lý cần đồng bộ backend, frontend, OpenAPI và tests; không âm thầm đổi transport vì sẽ ảnh hưởng client hiện tại.

## 5. README tổng không phản ánh đầy đủ code

[README backend](../../README.md) vẫn mô tả Prisma, Redis, OAuth và các module như phần dự kiến/khung rỗng. Trong khi đó, schema, migration, client PostgreSQL/Redis và mã AUTH đã tồn tại.

Khi đánh giá tiến độ, ưu tiên đọc code và tài liệu AUTH chi tiết; không dùng README tổng để kết luận Auth chưa làm, cũng không dùng hợp đồng API để kết luận Core đã làm. Việc cập nhật README tổng chưa thuộc thay đổi ghi chú này.

## 6. Khoảng trống cần đưa vào audit chi tiết

- Schema và migration Core: Workspace, memberships, invitations, Board/List/Card, assignment, label, task, comment, attachment, activity và dependency.
- Authorization tập trung: Owner/PM/Member, chain tài nguyên, account status, archive/frozen.
- Transaction/invariant: tạo và chuyển Owner/PM, member cleanup, move/reorder, dependency đồng thời, ghi activity.
- OCC, cardKey, ngày giờ, overdue, query/filter và dashboard.
- Kiểm thử âm tính: IDOR, truy cập Board chưa tham gia, quan hệ chéo Board/Workspace, mutation tài nguyên archive, dependency cycle, request đồng thời.
- Đối chiếu phạm vi mở rộng của SRS với scope master prompt; không tự coi QuickNote hoặc mọi yêu cầu AI/realtime là phần phải triển khai ngay.
- Xác định phần email queue cần cho lời mời; không bỏ yêu cầu BullMQ chỉ vì đợt hiện tại tập trung REST Core.

Đây chưa phải bảng audit DONE/PARTIAL/MISSING/BROKEN đầy đủ cho mọi yêu cầu. Những nội dung chưa đọc hoặc chưa chạy phải tiếp tục được đánh dấu chưa xác minh.

## 7. Công cụ kiểm tra sẵn có

Theo `package.json` tại thời điểm ghi nhận:

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm db:validate
```

Chưa có script `lint`. Không báo `pnpm lint` đã pass hoặc tự giả định tồn tại chỉ vì master prompt liệt kê lệnh đó. Tests sử dụng `tsx --test`; kiểm tra điều kiện PostgreSQL/Redis và môi trường test trước khi chạy integration tests.

## 8. Trình tự đề xuất

1. Hoàn thiện audit SRS ↔ code ↔ API contract, tách yêu cầu bắt buộc, điểm lệch và quyết định còn mở.
2. Chốt mô hình quyền hai cấp, schema Core và cách bảo vệ invariant.
3. Triển khai authorization, Workspace/membership/invitation rồi Board/PM/List.
4. Triển khai Card/move/reorder, assignment/label/task và collaboration.
5. Hoàn thiện dependency, archive, planning/search/dashboard theo scope đã chốt.
6. Kiểm tra quyền, concurrency, transaction và chạy các checks thực sự có trong repository.

Trình tự trên là định hướng, chưa thay thế kế hoạch implementation có tiêu chí nghiệm thu chi tiết.
