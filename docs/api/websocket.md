# Realtime Socket.IO

## Mục đích

Socket.IO đồng bộ các thay đổi Core cho người đang mở Workspace hoặc Board. PostgreSQL vẫn là nguồn dữ liệu chuẩn. REST và lệnh `card:move` gọi chung service nghiệp vụ; chỉ phát sự kiện sau khi service ghi DB thành công. Event Board hiện là thông báo invalidation, FE tải lại snapshot từ API để nhận thứ tự Card/List chuẩn.

## Kết nối và xác thực

- Socket.IO path: `/realtime/socket.io` trên cùng cổng với API.
- Transport hiện dùng WebSocket.
- FE gửi access token trong handshake `auth.token`, tuyệt đối không đưa token lên URL.
- Backend kiểm tra JWT và phiên đăng nhập, tự gán room `user:{userId}` và `session:{refreshTokenId}`; client không tự chọn các room này.
- Access token hết hạn thì server báo `session:expired` và đóng socket. FE gọi `/auth/me` qua Axios client hiện có để kích hoạt refresh token; khi access token mới được lưu, socket kết nối lại và join lại room.
- `SOCKET_ALLOWED_ORIGINS` là danh sách origin phân cách bằng dấu phẩy. Mặc định local là `http://localhost:5173`.

Ví dụ FE local truy cập BE qua Vite proxy `/realtime`. Khi deploy sau reverse proxy, cần chuyển tiếp WebSocket Upgrade cho path `/realtime/socket.io`.

## Rooms và giao thức

| Room | Ai được vào | Sự kiện |
| --- | --- | --- |
| `board:{boardId}` | Người dùng qua `board:join` sau khi backend kiểm tra quyền Board | `board:changed` |
| `workspace:{workspaceId}` | Thành viên Workspace qua `workspace:join` sau khi backend kiểm tra quyền | `workspace:changed` |
| `user:{userId}` | Backend tự gán theo phiên đã xác thực | `notifications:changed` |
| `session:{refreshTokenId}` | Backend tự gán theo phiên đã xác thực | Dùng để ngắt socket sau logout |

Client gửi `board:join` / `board:leave` với `{ boardId }` và nhận ACK `{ ok, data }` hoặc `{ ok: false, code }`. Workspace dùng `workspace:join` / `workspace:leave` tương tự. Event `board:changed` và `workspace:changed` có `eventId`, `schemaVersion: 1`, `occurredAt`, id tài nguyên và loại thay đổi. Client dùng event để invalidate snapshot; không dùng payload này thay quyền đọc REST.

Lệnh cộng tác hiện có:

```json
{
  "boardId": "<uuid>",
  "cardId": "<uuid>",
  "targetListId": "<uuid>",
  "position": 2048,
  "updatedAt": "<ISO timestamp>"
}
```

Gửi bằng `card:move`. Backend kiểm tra đã join Board, kiểm tra Card thuộc Board, validate payload, rồi gọi cùng `moveCard` service với REST (bao gồm quyền, dependency, transaction và OCC). ACK trả `{ ok: true, data: <Card> }`; lỗi trả `{ ok: false, code }`. Các phiên trong room, gồm cả phiên gửi lệnh, nhận `board:changed` sau commit. FE refetch snapshot khi nhận event; lỗi hoặc timeout làm tải lại dữ liệu. Vị trí hiển thị lấy từ Card response chuẩn do server trả về.

## Phạm vi đồng bộ hiện tại

Mutation REST thành công trong Board, Card, List, comment, attachment, task, assignment, label và dependency phát `board:changed`. Tạo/cập nhật thành viên, lời mời và workspace phát `workspace:changed`. Các API notification phát `notifications:changed`; worker nhắc hạn cũng phát tới đúng user sau khi tạo notification. FE đang tự đồng bộ Board, danh sách Board, workspace membership và board membership bằng snapshot/API hiện có.

Khi xóa Board hoặc thu hồi membership, backend ngắt kết nối các phiên liên quan. Người bị thu hồi không thể join lại nếu không còn quyền. Logout ngắt room session; logout-all ngắt toàn bộ room của user.

## Redis và khôi phục

Redis adapter chuyển room/broadcast giữa nhiều backend process. BullMQ dùng cùng Redis nhưng giữ queue riêng, không phải kênh realtime. Sau khi kết nối lại, FE join lại và tải snapshot REST; hệ thống không dựa vào event replay. Vì vậy thay đổi vẫn đọc được sau reconnect, kể cả khi client bỏ lỡ event.

Khi backend chủ động ngắt kết nối để thu hồi quyền hoặc xử lý archive, Socket.IO client không tự reconnect với lý do `io server disconnect`. FE gọi `connect()` lại nếu phiên chưa hết hạn, join lại room và tải snapshot REST kể cả khi join bị từ chối. Phản hồi 403/404 sẽ xóa dữ liệu Board/membership cũ trên giao diện. Xem [luồng quyền xem Board theo Workspace](../CORE/board-visibility-realtime.md).

## Chạy local

1. Khởi động Docker PostgreSQL và Redis.
2. Chạy backend (`pnpm dev:local`); API mặc định khởi động Socket.IO và BullMQ worker cùng process.
3. Chạy frontend (`npm run dev`); Vite chuyển tiếp `/api` và `/realtime` sang backend.
4. Mở cùng một Board bằng hai tài khoản/phiên có quyền. Kéo Card ở một phiên; phiên còn lại nhận invalidation và tải trạng thái mới.

Để chạy worker riêng: đặt `BACKGROUND_WORKERS_ENABLED=false` ở API, sau đó chạy `pnpm worker:dev` local hoặc `pnpm worker:start` production. Worker và API cùng kết nối PostgreSQL/Redis.

## Giới hạn cần biết

- `board:changed` là invalidation có `boardId`, loại thay đổi và thời điểm; payload nghiệp vụ không phát ra cho mọi thao tác. Cách này giữ quyền đọc qua REST và đảm bảo thứ tự sau move/reorder.
- FE có trung tâm thông báo với badge unread; sự kiện `notifications:changed` làm mới số lượng và danh sách trong panel.
- Integration test tạo hai Socket.IO server instance dùng chung Redis adapter trên local Docker PostgreSQL 17/Redis 7, với hai client nối vào hai instance. Trong 20 lần Card move, p50 là **17 ms**, p95 là **21 ms** (từ timestamp `occurredAt` được gắn sau commit đến lúc client còn lại nhận event; mục tiêu SRS < 500 ms). Một mẫu notification assignment mất **80 ms** từ lúc bắt đầu lệnh đến khi client nhận (mục tiêu <= 1 giây; chưa đủ mẫu để kết luận p95). Đây là phép đo tự động trên cùng máy và cùng process, chưa thay thế kiểm tra Chrome với trình duyệt thứ hai, nhiều process BE thật và môi trường triển khai theo SRS.
