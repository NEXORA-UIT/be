# Thứ tự triển khai Project Management Core

Ngày lập: **2026-10-07**. Đây là bản chia nhóm và thứ tự công việc để điều phối các session code. Nó dựa trên [bối cảnh](README.md), [quy tắc nghiệp vụ](business-rules.md), tài liệu module hiện hành và SRS. Đây chưa phải kế hoạch cấp file/hàm cho từng PR; trước khi code mỗi nhóm cần chốt API, schema liên quan và ca nghiệm thu cụ thể.

## Nguyên tắc chia việc

- **Một nguồn sự thật cho quyền và invariant.** Workspace có một Owner; Board có một PM. Core service kiểm tra quyền và quy tắc, controller chỉ xử lý HTTP.
- **Mỗi nhóm giao được một lát cắt chạy và kiểm thử được.** Không tách agent theo tầng `controller`/`service`/`repository` của cùng một tính năng; chúng cần được sửa và kiểm thử cùng nhau.
- **Một người sở hữu file dùng chung tại một thời điểm.** Đặc biệt là `prisma/schema.prisma`, migration, router tổng, shared error/authorization và hợp đồng API. Các nhánh module khác đề xuất thay đổi vào hợp đồng; người điều phối tích hợp tuần tự.
- **Giữ thay đổi AUTH hiện có.** Nhánh `feature/auth-oauth` đang có thay đổi chưa commit; cần chốt baseline trước khi tạo worktree chạy song song. Không để agent Core tự sửa file AUTH hoặc âm thầm giải quyết lệch refresh-token transport.
- **Tách Core REST khỏi realtime/AI.** Theo [quyết định hiện tại](deferred-infrastructure.md), BullMQ cho email và Socket.IO được làm ở đợt riêng sau; flow Workspace dùng email adapter hiện có.

## Các nhóm theo thứ tự phụ thuộc

| Nhóm                                  | Công việc và đầu ra kiểm tra được                                                                                                                                                                               | Điều kiện bắt đầu                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **0. Chốt nền và contract**           | Audit chi tiết SRS ↔ code ↔ OpenAPI; chốt bảng quyền Owner/PM/Member, trạng thái archive, contract API, phân loại phần Core và phần mở rộng được chọn; ghi các xung đột còn mở                                  | Bắt đầu ngay, chỉ đọc và tài liệu                                           |
| **1. Dữ liệu và authorization chung** | Prisma models/migration cho toàn Core; constraint, index, quan hệ; helper kiểm tra Workspace/Board/nested resource, active/archived/frozen; test cô lập dữ liệu                                                 | Sau nhóm 0                                                                  |
| **2. Workspace và membership**        | Tạo/list/get/update/archive/restore Workspace; Owner invariant và chuyển Owner; member list/remove/leave; Invitation gồm trạng thái bền vững, chấp nhận/từ chối, token/email trực tiếp trong giai đoạn hiện tại | Sau nhóm 1                                                                  |
| **3. Board, PM và List**              | Board CRUD/archive/restore; tạo Board + PM + List mặc định nguyên tử; thêm/xóa Board member; chuyển PM; List CRUD/reorder/statusGroup/archive                                                                   | Sau nhóm 2 cho quyền Workspace; dùng schema nhóm 1                          |
| **4. Card nền tảng**                  | Card create/get/update/move/reorder/archive/restore; cardKey; ngày giờ/OCC; trạng thái suy ra từ List; thứ tự và Activity cơ bản trong transaction                                                              | Sau nhóm 3                                                                  |
| **5A. Thành phần Card**               | Assignment, Label/CardLabel và Task; kiểm tra cùng Board, cleanup assignment, tiến độ Task; không tự chuyển Card sang Done                                                                                      | Sau nhóm 4                                                                  |
| **5B. Cộng tác Card**                 | Comment, Attachment và truy vấn Activity; quyền tác giả, giữ lịch sử, không đưa attachment vào Knowledge Base                                                                                                   | Sau nhóm 4                                                                  |
| **5C. Dependency**                    | Tạo/xóa/xem dependency; kiểm tra cùng Board, trùng, self-loop, cycle; chặn chuyển Done khi blocker chưa Done                                                                                                    | Sau nhóm 4; cần tích hợp với move Card của nhóm 4                           |
| **5D. Truy vấn và tiến độ**           | Search/filter Card, overdue, danh sách phục vụ Calendar/List View và Dashboard cơ bản theo phạm vi Board/quyền                                                                                                  | Sau nhóm 4; có thể tận dụng kết quả 5A/5C nếu filter assignee/label/blocked |
| **6. Kiểm tra tích hợp và hardening** | Rà IDOR, nested-resource spoofing, race condition, archive, transaction, OCC, thứ tự, permission âm tính; đồng bộ OpenAPI/docs và chạy các checks repo có thật                                                  | Sau khi các nhánh 5 đã tích hợp                                             |

Nhóm 5A–5D **có thể bắt đầu song song** sau khi contract Card ổn định. Một số phần của 5D phụ thuộc 5A/5C, nên phần query nền và dashboard trạng thái có thể làm trước; filter assignee/label/blocked được hoàn thiện khi quan hệ tương ứng đã tích hợp. Nhóm 5C cần phối hợp rõ với chủ sở hữu Card move để không có hai session cùng sửa logic chuyển sang Done.

## Cách phân chia session hiệu quả

### Làn chính do người điều phối giữ

Nhóm 0–4 theo thứ tự. Giai đoạn này nên ưu tiên **một người tích hợp schema/authorization và một lát cắt nghiệp vụ tại một thời điểm**; thêm nhiều session cùng viết domain foundation sẽ tăng xung đột hơn là tăng tốc.

### Làn song song sau Card Core

| Session | Phạm vi code sở hữu                                                                | Không tự sửa                                                                           |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A       | `modules/cards` cho Assignment/Label/Task và tests tương ứng                       | Schema/migration chung, Auth, Card move                                                |
| B       | `modules/collaboration` cho Comment/Activity read, adapter Attachment và tests     | Auth, schema/migration chung, Card service lõi                                         |
| C       | `modules/planning` cho Dependency và tests                                         | Auth, schema/migration chung; thay đổi guard Done đề xuất để tích hợp tại Card service |
| D       | Query service/Dashboard và tests trong phạm vi module được chốt trước khi dispatch | Auth, schema/migration chung, các endpoint module khác                                 |

Nếu có giới hạn số session, ưu tiên A, B, C trước; D có thể chạy sau hoặc chỉ làm phần query nền. Mỗi session dùng worktree/branch riêng trên cùng baseline đã chốt, có danh sách file sở hữu, contract đầu vào/đầu ra và test mục tiêu. Không dùng chung một working tree cho nhiều writer. Người điều phối review từng kết quả, tích hợp tuần tự và chạy bộ test chung sau mỗi lần tích hợp.

## Cổng nghiệm thu giữa các nhóm

| Sau nhóm | Bằng chứng tối thiểu trước khi mở nhóm tiếp                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0        | Ma trận quyền và phạm vi được ghi rõ; xung đột master prompt `Workspace PM` đã được sửa theo SRS                                           |
| 1        | Migration áp dụng được; constraint một Owner/một PM và các khóa quan hệ được kiểm tra; guard chặn truy cập chéo                            |
| 2        | Tạo Workspace tạo đúng Owner; chuyển Owner nguyên tử; rời/xóa giữ lịch sử và xử lý PM; lời mời không cấp quyền Board tự động               |
| 3        | Tạo Board luôn có một PM; PM chỉ quản lý Board được giao; Member không đọc Board chưa tham gia; List có statusGroup hợp lệ                 |
| 4        | Move/reorder không hỏng thứ tự; Card status suy ra từ List; OCC trả 409 khi stale; archive/restore tôn trọng cha                           |
| 5        | Mỗi module có test quyền và quan hệ chéo Board; dependency không cycle; truy vấn overdue/dashboard chỉ trả dữ liệu trong quyền             |
| 6        | Test tích hợp và kiểm tra thủ công các invariant chính; kết quả thực tế của typecheck, test, build, format và Prisma validate được báo cáo |

Các script hiện có trong `package.json` là `typecheck`, `test`, `build`, `format:check`, `db:validate`. Repo **chưa có script `lint`** tại thời điểm lập bảng này. Không thay thế kết quả chạy thực tế bằng checklist hoặc trạng thái tài liệu.

## Các việc cần chốt riêng trước khi code phần liên quan

1. **AUTH transport:** SRS yêu cầu refresh token qua cookie, code hiện tại dùng JSON. Đây là một thay đổi hợp đồng AUTH riêng; cần kiểm tra client và OpenAPI khi chọn thời điểm sửa, không để agent Core tự sửa ngầm.
2. **Phạm vi mở rộng:** Dependency, Calendar/List View và Dashboard thuộc `[E]` trong SRS nhưng được master prompt chọn cho đợt Core. QuickNote/Inbox chưa được chọn rõ; không đưa vào đợt này nếu chưa có quyết định phạm vi.
3. **Attachment storage:** Chốt nơi lưu, giới hạn và API upload thực tế trước khi session B viết adapter; Card Attachment phải tách khỏi Knowledge Base Document.
4. **Invitation delivery:** SRS yêu cầu BullMQ cho email mời. Giai đoạn này dùng email adapter trực tiếp theo [quyết định hoãn](deferred-infrastructure.md); queue/worker là phần việc sau Workspace REST.
5. **Chiến lược invariant DB:** “Đúng một Owner/PM” cần xem xét cả constraint/migration lẫn transaction khi chuyển vai trò; application check đơn thuần có race condition.
6. **Search/filter:** UC-Card-13 mô tả lọc tức thời trên dữ liệu client đã tải; master prompt yêu cầu thêm truy vấn server-side. Cần giữ API vừa đủ cho paging và planning, không nhân đôi endpoint thiếu lý do.

## Định nghĩa xong cho đợt REST Core

Chỉ gọi đợt này hoàn tất khi các nhóm trong phạm vi đã có code, migration, test nghiệp vụ/quyền, tài liệu API khớp code và kết quả kiểm tra thực tế. Những mục phải hoãn hoặc chưa hoàn tất được nêu riêng. Realtime, RAG, AI Agent, Tool Calling, AI Proposal/phê duyệt và GitHub connector không thuộc điều kiện hoàn tất của đợt này.
