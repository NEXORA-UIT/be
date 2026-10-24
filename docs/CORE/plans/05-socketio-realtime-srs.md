# Kế hoạch hoàn thiện realtime Socket.IO theo SRS

> **Dành cho người triển khai:** Thực hiện từng chặng với kiểm thử và review riêng; đọc lại SRS và hợp đồng hiện hành trước khi sửa code.

**Mục tiêu:** Hai người cùng mở một Board nhìn thấy thao tác Kanban, bình luận và thông báo đúng quyền, đúng thứ tự; mất kết nối thì tự phục hồi; thao tác thất bại thì hoàn tác giao diện. Không nhận dữ liệu từ Board đã bị thu hồi quyền.

**Kiến trúc đề xuất:** Socket.IO dùng WebSocket transport để nhận lệnh cộng tác và phát sự kiện. HTTP và Socket.IO gọi **cùng service nghiệp vụ**; PostgreSQL vẫn là nguồn dữ liệu chuẩn. Chỉ phát sự kiện sau khi transaction thành công. Client đồng bộ bù bằng REST snapshot sau khi kết nối lại.

**Công nghệ:** Express/TypeScript, Socket.IO server/client, PostgreSQL/Prisma, Redis adapter khi chạy nhiều instance. BullMQ là đợt riêng, không dùng làm kênh broadcast Board.

**Căn cứ:** *SRS Đồ án 1.pdf* 128 trang (trang PDF 21–23, 39, 61–67, 105, 112–113, 120, 124); mã nguồn BE `origin/main` tại `fa7f9b4`, FE `origin/staging` tại `3a277ba`, kiểm tra ngày 2026-10-23. Số trang tính từ trang đầu của PDF. [Đặc tả WebSocket cũ](../../api/websocket.md) là tài liệu của giao thức `ws` hiện tại, không phải hợp đồng Socket.IO sau chuyển đổi.

## 1. Trạng thái hiện tại và vấn đề phải sửa

| Vấn đề | Bằng chứng hiện tại | Hệ quả |
| --- | --- | --- |
| Hai nhánh chưa cùng phiên bản | BE realtime đã vào `main`; `staging` của BE chưa có. FE realtime đã vào `staging`. | Demo trên hai nhánh `staging` chưa kiểm thử được realtime đầu-cuối. |
| Sai thư viện so với yêu cầu mới | BE dùng `ws`, FE dùng `window.WebSocket`; chưa có `socket.io`/`socket.io-client`. | Socket.IO client không tương thích trực tiếp với endpoint `ws` cũ. |
| Quyền chỉ kiểm tra lúc join | `websocket.server.ts` gọi `requireBoardAccess` ở `JOIN_BOARD`; registry chỉ đóng socket khi logout. | Người bị loại khỏi Board/Workspace vẫn có thể nghe sự kiện tới khi ngắt kết nối. SRS 5.2.2 yêu cầu ngừng nhận ngay. |
| Hết hạn access token sai thời điểm | BE đặt thời điểm đóng socket bằng `Date.now() + 15 phút` lúc kết nối; FE gặp mã `4401` thì dừng. | Có thể nghe lâu hơn JWT thực tế và không tự refresh/rejoin. |
| Sự kiện kéo thả thiếu dữ liệu | BE có thể viết lại vị trí nhiều Card/List nhưng event chỉ gửi đối tượng vừa di chuyển; FE chỉ vá đối tượng đó. | Hai trình duyệt có thể sắp xếp khác nhau. |
| Phủ event chưa đủ | Hiện có 7 event: `CARD_CREATED`, `CARD_MOVED`, `CARD_UPDATED`, `CARD_ARCHIVED`, `CARD_DELETED`, `LIST_REORDERED`, `COMMENT_ADDED`. | Restore Card/List, sửa/xóa bình luận, cập nhật Task/assignment/label và thông báo cá nhân chưa đồng bộ. |
| Đặc tả cũ lệch runtime | `docs/api/websocket.md` còn ghi “chưa triển khai”, token trong query URL và có đoạn giả định BullMQ đã kích hoạt. | Người đọc có thể hiểu sai trạng thái và bảo mật của sản phẩm. |

**Phạm vi:** Hoàn thiện realtime cho nghiệp vụ Core đang có. Không đưa AI Agent, RAG, GitHub Connector hay xử lý nền vào nhánh Socket.IO. Những nghiệp vụ Core chưa có UI hoặc API phải được ghi là phụ thuộc, không giả định socket tự tạo ra chúng.

## 2. Truy vết đúng SRS và xung đột cần chốt

| SRS | Yêu cầu phải quan sát được | Tiêu chí kiểm thử |
| --- | --- | --- |
| 2.4.1–2.4.3; 5.2.1–5.2.2, tr. 21–23, 113 | Workspace đúng một Owner; Board đúng một PM; Owner thấy mọi Board của Workspace, PM chỉ Board được giao, Member chỉ Board đã được thêm; System Admin không mặc nhiên thấy nội dung. Quyền bị thu hồi thì socket ngừng nhận. | Thử đủ bốn vai trò, chuyển PM/Owner, kick Board/Workspace, khóa tài khoản, archive/xóa Board. |
| UC-COL-15, tr. 61–62; 4.2.3, tr. 105 | Đồng bộ kéo thả và chỉnh sửa Kanban giữa người cùng Board; client optimistic update; reconnect và tải snapshot; token hết hạn phải refresh; xung đột phải rollback. | Hai client, ngắt mạng, token hết hạn, hai lệnh move cạnh tranh và lệnh bị từ chối. |
| UC-COL-16, tr. 62–64 | Bình luận mới hiện tức thì; sửa/xóa bình luận cũng phát realtime; @mention tạo thông báo riêng. | Hai người cùng mở Card; tác giả sửa/xóa; người được nhắc nhận thông báo, người ngoài Board không nhận dữ liệu Card. |
| UC-COL-17, tr. 64–65 | Activity Log truy vấn từ DB theo trang, mới nhất trước. | Sau thao tác từ client khác, timeline đang mở được làm mới; lịch sử vẫn tải được sau reconnect. |
| UC-COL-18, tr. 65–67 | Notification lưu DB, đẩy đích danh; badge và trạng thái đã đọc đồng bộ. | Hai tab của cùng user và tab user khác; read/read-all/delete; liên kết tới tài nguyên đã mất. |
| UC-COL-19, tr. 68 | Quick Note chuyển thành Card thì Board đích nhận sự kiện. | Client khác đang xem Board thấy Card mới sau chuyển đổi. |
| 6.1.2, tr. 120; 6.6.1, tr. 124 | Đồng bộ Board dưới 500 ms; thông báo đẩy nội bộ tối đa 1 giây; kéo thả/realtime chạy trên tối thiểu hai trình duyệt được hỗ trợ. | Đo từ commit thành công đến khi client khác nhận; ghi kết quả p95 và các điều kiện đo. |

**Xung đột hợp đồng cần nêu công khai:** UC-COL-15 bước 3–5 (tr. 62) viết rằng client **gửi lệnh thay đổi qua WebSocket**, server kiểm tra quyền, ghi DB rồi broadcast tới các client khác; khi xung đột server yêu cầu rollback. Code hiện nay và [đặc tả cũ](../../api/websocket.md) dùng **REST để ghi, WebSocket chỉ phát**. Không thể tuyên bố cách hiện tại đáp ứng nguyên văn Use Case này.

**Quyết định đề xuất để bám nguyên văn SRS:** Các thao tác cộng tác trên Board có Socket.IO command kèm ACK; trước tiên là kéo thả Card, tiếp đến thao tác Card/List/Comment mà UI đang thực hiện. HTTP endpoint vẫn hoạt động cho Swagger/tích hợp. Cả hai đường vào dùng lại cùng service, validation, phân quyền, OCC và transaction. Mỗi thay đổi đã commit chỉ phát **một** sự kiện; người ra lệnh nhận dữ liệu chuẩn qua ACK, các phiên còn lại nhận broadcast. Nếu nhóm chọn giữ REST-only, phải cập nhật SRS/Use Case hoặc được giảng viên chấp thuận sai khác trước khi gọi là “đúng SRS”.

## 3. Hợp đồng Socket.IO mục tiêu

1. **Transport:** dùng `socket.io` và `socket.io-client` cùng major version; cấu hình `transports: ['websocket']` để đúng yêu cầu WebSocket của SRS. Dùng một path thống nhất, đề xuất `/realtime/socket.io`; không coi endpoint `/realtime` của native `ws` là tương thích. Gỡ giao thức cũ sau khi hai repo đã triển khai và kiểm thử chung.
2. **Xác thực:** client gửi access token trong `auth`, không đặt vào URL query. Middleware xác thực bằng cùng logic AUTH hiện có, lưu `userId`, `refreshTokenId` và **JWT `exp` thật** trong `socket.data`; không log token. Chặn kết nối không hợp lệ/LOCKED. Khi token sắp hết hạn hoặc bị revoke: dừng nhận, FE gọi refresh hiện có, kết nối lại, join lại và lấy snapshot. Logout/logout-all ngắt mọi socket liên quan. Giới hạn `Origin`, kích thước payload và tần suất command.
3. **Phòng:** `board:{boardId}` cho dữ liệu Board và `user:{userId}` cho Notification cá nhân. `board:join`/`board:leave` có ACK và kiểm tra `requireBoardAccess` ở backend; không join theo vai trò khai báo từ client. Room user chỉ do server tự gán. Không gửi email hoặc dữ liệu riêng không cần thiết trong payload Board.
4. **Thu hồi quyền:** sau transaction chuyển Owner/PM, xóa Board member/Workspace member, archive/xóa Board hoặc khóa tài khoản, xác định các socket mất quyền rồi rời room hoặc ngắt kết nối. Recheck quyền khi xử lý mỗi command. Room eviction xuyên instance có thể đến muộn; trước khi gửi payload Board nhạy cảm, tầng phát phải xác nhận người nhận vẫn có quyền hoặc dùng cơ chế ACL version có kiểm chứng để chặn race giữa revoke và broadcast. Chỉ đuổi room mà không bảo vệ đường phát là chưa đủ cho tiêu chí “không nhận sự kiện sau thu hồi quyền”. Nếu phát hiện quyền không còn trên reconnect/join, trả lỗi không lộ sự tồn tại Board.
5. **Lệnh và ACK:** `card:move` là lệnh đầu tiên, payload gồm `commandId`, `boardId`, `cardId`, `targetListId`, `position`, `updatedAt`. Server validate theo DTO REST, gọi `moveCard`, trả ACK `{ok, card}` hoặc `{ok:false, code}`. FE optimistic update; lỗi 403/404/409 hoặc timeout thì lấy snapshot và rollback. Nếu bật retry tự động, `commandId` phải có bản ghi chống lặp **bền vững và ghi nguyên tử cùng thay đổi nghiệp vụ**; Redis TTL riêng không bảo đảm chống thực thi hai lần khi server lỗi giữa commit và ACK. Retry không được tạo hai ActivityLog/Notification. `list:reorder` và các lệnh Card/Comment khác đi qua cùng mẫu khi mở rộng, không sao chép service.
6. **Event:** giữ tên SRS `CARD_CREATED`, `CARD_MOVED`, `CARD_UPDATED`, `CARD_DELETED`, `COMMENT_ADDED`; thêm `CARD_ARCHIVED`, `CARD_RESTORED`, `LIST_CHANGED`, `COMMENT_UPDATED`, `COMMENT_DELETED`, `CARD_DETAILS_CHANGED`, `NOTIFICATION_CHANGED`, `ACCESS_REVOKED`. `LIST_CHANGED` và `CARD_DETAILS_CHANGED` là event **đề xuất của dự án**, dùng để refetch phần dữ liệu liên quan khi nhiều bản ghi cùng đổi; chúng không phải tên bắt buộc từ SRS. Đối với xóa/restore List/Board, phát invalidation thích hợp để các view đang mở tự cập nhật.
7. **Envelope:** `{event, eventId, occurredAt, boardId?, actor?, data, schemaVersion}`. `eventId` cho dedupe; `schemaVersion` tránh FE đọc nhầm payload sau triển khai lệch phiên bản. `CARD_MOVED` và `LIST_CHANGED` phải chứa **thứ tự chuẩn sau transaction của toàn bộ List/Card bị ảnh hưởng**, hoặc yêu cầu FE refetch snapshot; không gửi một `newPosition` rồi giả định các phần tử khác giữ nguyên. Mốc `updatedAt` dùng cho OCC của Card, không coi là thứ tự toàn cục giữa các event.
8. **Phục hồi:** khi join/rejoin thành công, FE tải `GET /api/v1/boards/{id}`, `GET /api/v1/boards/{id}/lists` cùng dữ liệu Card theo API hiện có; trong lúc tải thì đệm event, áp snapshot, rồi áp event mới hợp lệ hoặc refetch lần nữa nếu không chắc thứ tự. Không dựa vào replay mặc định của Redis adapter: adapter này không hỗ trợ Socket.IO connection state recovery. Khi mất mạng, hiện banner offline/reconnecting; không báo “live” trước khi join và snapshot hoàn tất.
9. **Nguồn dữ liệu:** Notification và ActivityLog luôn ghi vào PostgreSQL. Event chỉ báo thay đổi/đẩy dữ liệu tối thiểu; GET API vẫn tải lại được sau khi Redis, socket hoặc tab trình duyệt khởi động lại.

## 4. Thứ tự triển khai có thể review riêng

### Chặng 0 — Tích hợp baseline và chốt contract

- [ ] Đưa BE/FE về cặp commit cùng có realtime; ghi rõ target branch để tránh FE `staging` chạy với BE `staging` cũ.
- [ ] Chốt quyết định ở mục 2 về command qua Socket.IO với nhóm; cập nhật tài liệu này nếu lựa chọn khác.
- [ ] Chốt danh mục command/event, payload và mã lỗi chung. Sửa `docs/api/websocket.md` thành hợp đồng Socket.IO hoặc lưu bản cũ dưới nhãn legacy; cập nhật `docs/api/endpoint-matrix.md` và OpenAPI description để không quảng bá native `ws` như Socket.IO.
- [ ] Test hợp đồng: BE và FE dùng chung fixture JSON/types cho join, ACK, event, conflict và access revoked.

### Chặng 1 — Transport, AUTH và quyền

- [ ] BE thay `src/infrastructure/websocket/*` bằng module Socket.IO gắn vào HTTP server; FE thay `src/lib/websocket/websocket-client.ts` bằng Socket.IO client. Giữ boundary để service không phụ thuộc trực tiếp vào transport.
- [ ] Lấy hạn JWT thật; refresh/reconnect/rejoin/snapshot; logout và LOCKED ngắt phiên. Token chỉ đi trong `auth`.
- [ ] Join/leave Board và room user; cưỡng chế rời room khi quyền bị thu hồi từ Board, Workspace, PM/Owner hoặc hệ thống. Dùng cùng access service của REST.
- [ ] Kiểm thử: user ngoài Board/System Admin không join; member bị kick không nhận event tiếp theo dù socket vẫn mở; token hết hạn tự phục hồi; logout-all cắt nhiều tab.

### Chặng 2 — Kanban và xung đột

- [ ] Đưa `card:move` qua Socket.IO ACK và service `moveCard`; FE drag/drop optimistic, timeout/409/403 rollback về snapshot. HTTP `PATCH /cards/:id/move` vẫn dùng cùng service.
- [ ] Đồng bộ Card create/update/archive/restore/delete, List create/update/reorder/archive/restore; Quick Note chuyển Card. Với thao tác đổi nhiều position/status, event mang thứ tự chuẩn hoặc invalidation/refetch.
- [ ] Kiểm thử hai trình duyệt: kéo thả trong/cross List, nhiều Card, đổi `List.statusGroup` suy ra Card status, Dependency chặn Done, OCC race, archive/restore, command retry; rollback DB thì không broadcast.

### Chặng 3 — Cộng tác Card và thông báo

- [ ] Bình luận thêm/sửa/xóa; giữ quy tắc tác giả/quyền và không phát nội dung đã xóa. Modal Card đang mở tự cập nhật; ActivityLog vẫn truy vấn theo trang qua REST.
- [ ] Khi assignment hoặc @mention tạo Notification, phát tới `user:{id}` sau commit; read/read-all/delete cập nhật mọi tab của chính user. Task, label, dependency, attachment và Card detail phát `CARD_DETAILS_CHANGED` để view đang mở refetch phần liên quan. Không biến Attachment thành tài liệu Knowledge Base.
- [ ] Kiểm thử isolation: một Board khác và user khác không nhận Card/Notification; user bị thu hồi quyền không mở được link cũ; thông báo tồn tại sau reconnect.

### Chặng 4 — Đa instance, hiệu năng và bàn giao

- [ ] Nếu demo/triển khai chạy nhiều process, thêm `@socket.io/redis-adapter` với Redis Pub/Sub, kiểm thử hai BE instance và thu hồi room xuyên instance. Nếu chỉ một process, ghi rõ adapter là cổng triển khai trước scale; không tuyên bố đã chạy cluster.
- [ ] Đo từ sau commit đến event ở client còn lại: mục tiêu SRS < 500 ms; Notification <= 1 giây. Ghi p50/p95, số client, mạng và môi trường. Test Chrome + trình duyệt thứ hai nhóm chọn.
- [ ] Chạy BE test/typecheck, FE test/typecheck/lint/build, test E2E Docker PostgreSQL/Redis và một kịch bản demo hai tài khoản; xác nhận Swagger REST vẫn chạy.
- [ ] Sau khi hai repo đã chuyển hoàn toàn và có kết quả E2E, xóa `ws`/native client cũ và cập nhật tài liệu cấu hình deploy/proxy.

## 5. Cổng nghiệm thu

Tài liệu/implementation được coi là khép luồng realtime khi: (1) cùng cặp BE/FE chạy được; (2) không rò dữ liệu sau thu hồi quyền; (3) ACK/rollback/reconnect/snapshot đúng trên hai trình duyệt; (4) toàn bộ thao tác Core trong mục 4 cập nhật view liên quan; (5) Notification cá nhân không phát chéo; (6) đo đạt mục tiêu thời gian trong môi trường kiểm thử đã ghi; (7) hợp đồng và docs không còn tuyên bố sai về `ws`, Socket.IO hoặc BullMQ.

## 6. Ranh giới với luồng bất đồng bộ sẽ bàn tiếp

Socket.IO giải quyết **phân phối tức thời tới client đang online**. BullMQ giải quyết **công việc chạy nền, retry và giới hạn tải** như email, dọn tệp, xử lý tài liệu. Redis adapter của Socket.IO chỉ chia sẻ room/broadcast giữa BE instances; nó không thay BullMQ và cũng không tự bảo đảm event bị mất sau restart. Thiết kế job/outbox, trạng thái nghiệp vụ bền vững, retry/idempotency và cách phát kết quả từ worker cần một tài liệu riêng sau khi thống nhất phạm vi bất đồng bộ.

## Nguồn kỹ thuật Socket.IO

- [Auth, transport và retry của client](https://socket.io/docs/v4/client-options/)
- [Middleware xác thực](https://socket.io/docs/v4/middlewares/)
- [Rooms](https://socket.io/docs/v4/rooms/)
- [Redis adapter và giới hạn connection state recovery](https://socket.io/docs/v4/redis-adapter/)
