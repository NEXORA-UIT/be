# Backend naming conventions

Tài liệu này là quy ước đặt tên dùng chung cho các module backend Nexora. Mục tiêu là để người đọc đoán được trách nhiệm của một file/hàm từ tên của nó, đồng thời tránh tạo nhiều tên cho cùng một loại thao tác.

Quy ước áp dụng cho code mới và khi mở rộng module hiện có. Khi sửa code cũ, giữ tên public đang được client sử dụng; chỉ đổi tên khi có migration/import rõ ràng và test cập nhật đầy đủ.

## 1. Quy tắc nền

- File và thư mục dùng **kebab-case** khi tên có nhiều từ: `workspace-membership`, `error.middleware.ts`.
- Biến, hàm, property và method dùng **camelCase**: `workspaceId`, `findByEmail`.
- Type, interface, enum và class dùng **PascalCase**: `WorkspaceAccess`, `CreateWorkspaceDto`.
- Hằng số module dùng **UPPER_SNAKE_CASE**: `AUTH_SECURITY`, `MAX_PAGE_SIZE`.
- Tên domain dùng số ít trong code và model: `Workspace`, `Card`, `workspaceRepository`. URL collection dùng số nhiều: `/workspaces`, `/cards`.
- Dùng tên nghiệp vụ đã chốt trong SRS: `Owner`, `PM`, `Member`, `Workspace`, `Board`, `List`, `Card`, `Task`. Không viết tắt tuỳ ý như `Ws`, `Bd`, `Mgr`.
- Tên public phải nói rõ phạm vi. `getById` quá chung; dùng `findWorkspaceById` hoặc `getWorkspace` tuỳ layer.

## 2. Tên file theo layer

Mỗi module giữ cấu trúc hiện có:

```text
modules/<domain>/
  routes/index.ts
  controllers/<domain>.controller.ts
  services/<domain>.service.ts
  repository/<domain>.repository.ts
  dto/<domain>.schema.ts
  utils/<domain>.errors.ts
```

| Layer         | Mẫu tên                   | Ví dụ                                |
| ------------- | ------------------------- | ------------------------------------ |
| Route         | `routes/index.ts`         | `modules/workspaces/routes/index.ts` |
| Controller    | `<domain>.controller.ts`  | `workspace.controller.ts`            |
| Service       | `<domain>.service.ts`     | `workspace.service.ts`               |
| Repository    | `<domain>.repository.ts`  | `workspace.repository.ts`            |
| Validation    | `<domain>.schema.ts`      | `workspace.schema.ts`                |
| Error factory | `<domain>.errors.ts`      | `workspace.errors.ts`                |
| Middleware    | `<purpose>.middleware.ts` | `require-auth.middleware.ts`         |
| Shared policy | `<purpose>.service.ts`    | `access.service.ts`                  |
| Test          | `<domain>.<kind>.test.ts` | `workspace-core.integration.test.ts` |

Không đặt tên file theo HTTP verb (`post-workspace.ts`) hoặc theo một màn hình frontend. Một file service có thể chứa nhiều use case cùng domain; tách file khi trách nhiệm đã thành hai domain khác nhau.

## 3. Hàm service và use case

Service là nơi điều phối nghiệp vụ, transaction và authorization. Tên hàm bắt đầu bằng động từ và kết thúc bằng resource chính:

| Ý định                              | Mẫu chuẩn                | Ví dụ                                        |
| ----------------------------------- | ------------------------ | -------------------------------------------- |
| Tạo                                 | `create<Resource>`       | `createWorkspace`, `createBoard`             |
| Lấy một resource sau khi kiểm quyền | `get<Resource>`          | `getWorkspace`, `getCard`                    |
| Liệt kê                             | `list<Resources>`        | `listWorkspaces`, `listWorkspaceMembers`     |
| Cập nhật                            | `update<Resource>`       | `updateWorkspace`, `updateCard`              |
| Archive                             | `archive<Resource>`      | `archiveWorkspace`                           |
| Khôi phục                           | `restore<Resource>`      | `restoreWorkspace`                           |
| Xóa theo nghiệp vụ                  | `remove<Resource>`       | `removeWorkspaceMember`, `removeBoardMember` |
| Rời scope hiện tại                  | `leave<Resource>`        | `leaveWorkspace`                             |
| Chuyển vai trò                      | `transfer<Role>`         | `transferOwner`                              |
| Gán vai trò                         | `assign<Resource><Role>` | `assignBoardPm`                              |
| Di chuyển                           | `move<Resource>`         | `moveCard`                                   |
| Sắp xếp                             | `reorder<Resource>`      | `reorderCard`, `reorderList`                 |
| Tìm kiếm                            | `search<Resources>`      | `searchCards`                                |
| Tổng hợp                            | `get<Resource>Summary`   | `getBoardDashboard`                          |

Quy tắc tham số:

```ts
createWorkspace(userId, input);
updateWorkspace(userId, workspaceId, input);
removeWorkspaceMember(actorId, workspaceId, memberUserId);
```

Tham số actor luôn đứng đầu; ID của resource scope đứng trước ID resource con; DTO/input đứng cuối. Dùng tên `actorId` cho người thực hiện thay đổi và `userId` cho user mục tiêu. Không dùng `id1`, `target`, `data` nếu có tên domain rõ hơn.

## 4. Hàm authorization và policy

Authorization dùng tiền tố `require` khi hàm phải ném `AppError` nếu không đủ quyền. Hậu tố mô tả chính xác scope hoặc capability:

```ts
requireWorkspaceAccess(userId, workspaceId);
requireWorkspaceOwner(userId, workspaceId);
requireWorkspaceWriteAccess(userId, workspaceId);
requireBoardAccess(userId, boardId);
requireBoardManager(userId, boardId);
requireBoardWriteAccess(userId, boardId);
requireResourceInBoard(resource, resourceId, boardId);
```

Các quy tắc bắt buộc:

- `require...` trả context đã kiểm tra hoặc ném lỗi; không trả `boolean` rồi để caller tự đoán.
- `...Access` nghĩa là được đọc/truy cập scope.
- `...Owner`, `...Manager` nghĩa là kiểm tra capability quản trị cụ thể.
- `...WriteAccess` bao gồm kiểm tra archive/frozen cho thao tác ghi.
- Hàm chỉ đọc hoặc trả `false` dùng tiền tố `can`/`has`, ví dụ `canEditComment`, `hasBoardMembership`; không đặt tên `require` cho hàm boolean.
- Không dùng tên `requireWorkspacePm`: SRS không có PM ở cấp Workspace.

Authorization service không được đặt trong controller. Core service phải gọi lại policy khi được gọi từ worker/tool; middleware route chỉ là lớp tiện ích sớm.

## 5. Repository

Repository chỉ truy cập Prisma/Redis/adapter của chính domain. Không chứa HTTP response hoặc quyết định role.

```ts
workspaceRepository.create(...)
workspaceRepository.findById(workspaceId)
workspaceRepository.findManyForUser(userId)
workspaceRepository.update(workspaceId, data)
membershipRepository.findByWorkspaceAndUser(workspaceId, userId)
membershipRepository.updateRole(membershipId, role)
```

Quy tắc method:

- `findBy<UniqueField>` cho một bản ghi có thể không tồn tại và trả `null`.
- `find<Thing>OrThrow` chỉ dùng khi repository đã thống nhất lỗi not found; không trộn với `findBy...` trong cùng use case mà không lý do.
- `findManyBy<Scope>` cho danh sách theo foreign key/scope.
- `create`, `update`, `delete` cho thao tác persistence cơ bản.
- Dùng `remove` ở service cho nghiệp vụ; dùng `delete` ở repository cho câu lệnh xóa dữ liệu.
- Transaction nhiều bước do service sở hữu; repository nhận transaction client nếu cần, không tự mở transaction cho mọi query.

## 6. Controller, route và validation

Controller chỉ đọc `request`, gọi một service và đóng gói response:

```ts
export async function createWorkspaceController(request: Request, response: Response) {
  const workspace = await createWorkspace(request.auth.userId, request.body as CreateWorkspaceDto);
  response.status(201).json({ success: true, data: workspace });
}
```

Tên controller dùng `<verb><Resource>Controller`. Tên route dùng resource REST và suffix hành động khi hành động không phải CRUD:

```text
POST   /workspaces
GET    /workspaces/:id
PATCH  /workspaces/:id/archive
PATCH  /workspaces/:id/unarchive
POST   /workspaces/:id/leave
PATCH  /workspaces/:id/members/:userId
```

Schema Zod dùng `<operation><Resource>Schema`; type suy ra dùng `<Operation><Resource>Dto`:

```ts
createWorkspaceSchema → CreateWorkspaceDto
updateWorkspaceSchema → UpdateWorkspaceDto
```

Không viết schema validation trong controller và không đặt tên type theo HTTP như `PostWorkspaceBody`.

## 7. Error, enum và response

- Error factory theo domain: `accessErrors.forbidden()`, `workspaceErrors.ownerTransferTargetInvalid()`.
- Factory tạo `AppError` mới ở mỗi lần gọi; không export một instance dùng chung.
- Error code là UPPER_SNAKE_CASE: `WORKSPACE_NOT_FOUND`, `WORKSPACE_OWNER_REQUIRED`, `RESOURCE_ARCHIVED`.
- Enum Prisma dùng UPPER_SNAKE_CASE: `WorkspaceRole.OWNER`, `BoardRole.PM`, `Status.DONE`.
- Response luôn dùng `{ success: true, data }` hoặc error envelope hiện có. Không đặt tên response `result`, `payload` hoặc envelope thứ hai.

## 8. Test naming

Tên test mô tả actor, hành động và kết quả:

```ts
it('allows an owner to access every board in the workspace', ...)
it('rejects a workspace member without board membership', ...)
it('transfers ownership without creating two owners', ...)
```

File test dùng domain + loại test: `<domain>.unit.test.ts`, `<domain>.integration.test.ts`, `<domain>.http.integration.test.ts`. Test permission và business rule ưu tiên integration/service; không test implementation detail của controller.

## 9. Quy tắc đổi tên hiện trạng

Các tên đã dùng hiện tại được xem là canonical cho đến khi có migration:

| Đang có               | Quyết định                                                                  |
| --------------------- | --------------------------------------------------------------------------- |
| `requireBoardManager` | Giữ nguyên; nghĩa là Owner hoặc PM có quyền quản trị Board                  |
| `removeMember`        | Khi mở rộng đổi thành `removeWorkspaceMember` để tránh mơ hồ                |
| `listMembers`         | Trong module Workspace đổi thành `listWorkspaceMembers`                     |
| `getWorkspace`        | Giữ nguyên vì đang nằm trong `workspace.service.ts`                         |
| `access.service.ts`   | Giữ nguyên cho policy dùng chung; không tạo thêm `authorization.service.ts` |

Khi thêm code mới, dùng tên canonical ở các mục trên. Không đổi hàng loạt import chỉ để đổi style; gom rename vào một commit riêng có test/typecheck.

## 10. Checklist review

- Tên hàm có nói rõ động từ, resource và scope chưa?
- `require` có thật sự ném lỗi khi sai quyền không?
- Actor ID và target ID có phân biệt rõ không?
- Repository có tránh chứa HTTP/business policy không?
- Controller có gọi service thay vì Prisma/Redis trực tiếp không?
- DTO/schema/type có cùng một tên gốc không?
- Tên route có giữ contract OpenAPI không?
- Test có mô tả hành vi và kết quả, đặc biệt ca vượt quyền không?
