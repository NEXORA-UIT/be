# Luồng dữ liệu và quyền xem Board theo Workspace

Tài liệu này mô tả trường hợp hai người cùng mở một Workspace nhưng thấy số Board khác nhau, cùng các tình huống đồng bộ liên quan. Căn cứ nghiệp vụ là SRS: Workspace có đúng một Owner; mỗi Board có đúng một PM; Owner xem mọi Board trong Workspace, còn Member chỉ xem Board mà mình được thêm vào. System Admin không mặc nhiên đọc nội dung dự án. PM chỉ quản lý Board được phân công.

## Nguồn dữ liệu và đường đi

```text
PostgreSQL: WorkspaceMembership + BoardMembership + Board
    → GET /api/v1/workspaces/:workspaceId/boards
    → BE lọc theo người gọi
    → FE useWorkspaceBoards
    → Overview / Boards / bộ đếm Board

Mutation REST thành công
    → realtime-mutation middleware
    → workspace:changed hoặc board:changed (chỉ báo cần làm mới)
    → FE gọi lại REST, không lấy Board từ payload Socket.IO
```

`listWorkspaceBoards` kiểm tra WorkspaceMembership trước. Nếu vai trò là Owner, truy vấn trả mọi Board thuộc Workspace. Nếu là Member, truy vấn chỉ trả Board có BoardMembership của chính người đó. `includeArchived=true` bổ sung Board đã lưu trữ **trong phạm vi người đó được xem**, không mở rộng quyền. Vì vậy Owner thấy 1 Board, Member thấy 0 Board như ảnh chụp là đúng nếu Member chưa được thêm vào Board. Để Member thấy Board, Owner/PM thêm họ vào Board; chỉ thêm vào Workspace là chưa đủ.

FE tính số Board từ danh sách REST đã lọc. Khi kết nối Socket.IO, client join room Workspace/Board sau khi BE kiểm tra lại quyền. `workspace:changed` và `board:changed` không chứa nội dung Board; client tải snapshot mới qua REST. Khi mất kết nối và nối lại, client join lại rồi tải snapshot để bù các event đã bỏ lỡ. BE ngắt các kết nối liên quan khi thu hồi membership, đổi Owner/PM, archive hoặc xóa; quyền vẫn do REST và Socket.IO kiểm tra độc lập ở mỗi request/join.

## Các trường hợp cần kiểm tra

| Tình huống                                                       | Kết quả đúng / hành động đồng bộ                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner tạo Board                                                  | Owner thấy Board mới; Member chưa thuộc Board vẫn thấy 0.                                                                                                                            |
| Member được thêm vào Board khi đang mở Overview                  | BE phát `workspace:changed`; FE tải lại danh sách và bộ đếm tăng.                                                                                                                    |
| Member bị xóa khỏi Board hoặc Workspace                          | BE ngắt socket; FE phải tải lại và xóa dữ liệu cũ khi REST trả 403/404. Không để Board cũ nằm trên màn hình.                                                                         |
| Chuyển Owner Workspace                                           | Owner mới được xem mọi Board; Owner cũ chỉ còn Board mà họ có BoardMembership. Hai phía phải tải lại sau khi kết nối lại.                                                            |
| Đổi PM Board                                                     | PM cũ/mới được kiểm tra quyền lại; danh sách Workspace và Board detail cập nhật theo membership sau giao dịch.                                                                       |
| Archive, restore hoặc xóa Board                                  | Bộ đếm active/archived và danh sách thay đổi theo snapshot; người đang mở Board đã archive/xóa không tiếp tục chỉnh sửa.                                                             |
| Archive Workspace                                                | Không join được room đã archive; các màn đang mở phải tải lại trạng thái REST và khóa thao tác theo trạng thái Workspace.                                                            |
| Mất mạng, proxy WebSocket lỗi, hoặc đổi access token             | Hiển thị trạng thái kết nối phù hợp; sau reconnect join lại và tải snapshot. Event Socket.IO không phải nguồn dữ liệu bền vững.                                                      |
| BE chủ động ngắt socket khi thu hồi quyền/archive                | Socket.IO không tự reconnect với lý do `io server disconnect`; FE phải gọi `connect()` lại, join lại và tải REST kể cả khi join bị từ chối. Không tự reconnect khi phiên đã hết hạn. |
| Chuyển Workspace/Board nhanh khi request cũ chưa xong            | Phản hồi của đối tượng cũ không được ghi đè màn mới.                                                                                                                                 |
| Request cũ hoàn tất sau khi quyền bị thu hồi                     | Kết quả cũ không được khôi phục vào state sau phản hồi 403/404 mới hơn.                                                                                                              |
| Lời mời hoặc danh sách thành viên còn trên màn sau khi mất quyền | FE xóa dữ liệu membership/invitation cũ khi REST trả 403/404; chuyển Workspace/Board không được hiện dữ liệu của đối tượng trước.                                                    |
| Cùng một người mở nhiều tab                                      | Mỗi tab join và tải snapshot riêng; mutation của một tab phải làm mới tab còn lại.                                                                                                   |
| Board nằm trong Workspace khác                                   | Không thể lấy Board bằng ID rồi ghép vào danh sách Workspace hiện tại; BE phải kiểm tra workspaceId và membership.                                                                   |

## Kịch bản kiểm chứng thủ công

1. Đăng nhập Owner và Member ở hai trình duyệt khác nhau, cùng mở Overview của một Workspace.
2. Owner tạo Board: Owner thấy 1, Member thấy 0. Kiểm tra cả REST response ở mỗi tài khoản.
3. Owner thêm Member vào Board: Member thấy Board và số đếm tăng mà không reload trang.
4. Owner xóa Member khỏi Board khi Member đang mở Board detail: dữ liệu Board biến mất hoặc hiện lỗi không còn quyền; Member không thể kéo Card.
5. Thêm lại Member, chuyển Owner hoặc PM, archive/restore Board, rồi lặp lại kiểm tra hai trình duyệt.
6. Tắt/bật BE hoặc ngắt mạng ngắn: sau reconnect, danh sách và Board detail khớp REST. Chuyển Workspace liên tục trong lúc mạng chậm để kiểm tra phản hồi cũ.

Không dùng việc hai người có cùng WorkspaceMembership để suy ra họ phải thấy cùng số Board. Nếu số đếm vẫn không đổi sau khi thêm BoardMembership, kiểm tra mutation trả 2xx, event `workspace:changed`, kết nối `/realtime/socket.io`, ACK join và cuối cùng là response REST. Lỗi `ECONNABORTED` tại Vite proxy chỉ cho biết socket bị ngắt; cần đối chiếu thời điểm BE restart, reconnect và snapshot trước khi kết luận dữ liệu sai.

BE đã phát invalidation ở phạm vi Workspace cho mutation Board ảnh hưởng đến danh sách/quyền xem. FE đã được bổ sung đọc lại REST khi join bị từ chối, reconnect thủ công sau ngắt kết nối từ server, loại phản hồi API cũ khi chuyển Workspace/Board, và dọn dữ liệu cũ sau 403/404. Đây là bảo vệ trạng thái giao diện; BE vẫn là nơi quyết định quyền.

Test tự động hiện kiểm tra event làm mới Workspace khi thêm Board member, trạng thái FE sau 403, chuyển Workspace/Board lúc request cũ chưa hoàn tất, và reconnect sau khi BE chủ động ngắt socket. Kịch bản hai trình duyệt ở trên vẫn cần chạy thủ công với tài khoản/dữ liệu demo để xác nhận đường mạng và UI thực tế.

Tham khảo hành vi reconnect: [Socket.IO client-side Socket — disconnect reasons](https://socket.io/docs/v4/client-socket-instance/#disconnect).
