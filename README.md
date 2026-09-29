# Nexora Backend

Base TypeScript + Express theo kiến trúc modular monolith. Các module được chia theo nhóm use case trong `SRS Đồ án 1.pdf`, có cập nhật vai trò Owner theo yêu cầu mới.

## Chạy dự án

Yêu cầu Node.js 22 trở lên và pnpm.

```sh
pnpm install
pnpm dev
```

Mở http://localhost:3000/ để nhận `Hello World!`. Biến môi trường `PORT` ghi đè cổng mặc định 3000.

```sh
pnpm typecheck
pnpm build
pnpm start
```

## Cấu trúc

```text
src/
  app.ts                       Khởi tạo Express, gắn router
  server.ts                    Khởi động HTTP server
  routes/
    index.ts                   Tổng hợp router module dưới /api/v1
  config/
    app.config.ts              Cổng HTTP hiện tại
    database/                  Cấu hình PostgreSQL, pgvector trong tương lai
    redis/                     Cấu hình Redis trong tương lai
    bullmq/                    Cấu hình queue, retry, backoff trong tương lai
    email/                     Cấu hình SMTP trong tương lai
    storage/                   Cấu hình R2, Cloudinary trong tương lai
    oauth/                     Cấu hình Google/GitHub OAuth trong tương lai
    ai/                        Cấu hình LLM, embedding, Langfuse trong tương lai
    document-parser/           Cấu hình Apache Tika trong tương lai
  infrastructure/
    database/                  DB client, migration, truy cập hạ tầng dữ liệu
    redis/                     Redis client, cache, pub/sub
    bullmq/                    Queue connection, producer và hợp đồng job
    email/                     SMTP adapter
    storage/                   R2/Cloudinary adapter
    oauth/                     OAuth provider adapter
    ai/                        LLM, embedding và tracing adapter
    document-parser/           Tika adapter
    github/                    GitHub API client
    realtime/                  WebSocket transport và quản lý kết nối
  modules/
    auth/
    workspaces/
    boards/
    cards/
    collaboration/
    planning/
    knowledge-base/
    ai/
    github/
    system-admin/
  shared/
    utils/                     Hàm tiện ích dùng chung, không chứa nghiệp vụ module
    middlewares/               Express middleware dùng chung
    types/                     Kiểu dữ liệu dùng chung
    errors/                    Kiểu lỗi dùng chung
  workers/
    processors/                Điểm xử lý job, gọi service của module
    schedulers/                Đăng ký lịch chạy job
```

Ngoài `app.config.ts`, các thư mục config, infrastructure, shared và workers hiện là khung giữ bằng `.gitkeep`. Chưa có client, kết nối hay worker đang chạy. Không cần Redis, database hoặc API key để chạy Hello World.

## Module và phạm vi dự kiến

| Module | Nhóm SRS | Trách nhiệm khi triển khai nghiệp vụ |
| --- | --- | --- |
| `auth` | AUTH | Đăng ký, đăng nhập, phiên, hồ sơ, đăng nhập Google/GitHub |
| `workspaces` | WS | Workspace, thành viên, lời mời, Owner, chỉ định PM |
| `boards` | BOARD | Board/dự án, List, thành viên và quyền truy cập Board |
| `cards` | CARD | Card, Task/checklist, assignee, Label, attachment, sắp xếp Card |
| `collaboration` | COL | Bình luận, lịch sử hoạt động, thông báo, sự kiện cập nhật Board |
| `planning` | PLAN | Calendar/list view, Inbox, phụ thuộc Card, dashboard tiến độ |
| `knowledge-base` | KB | Tài liệu theo Board, xử lý tài liệu, RAG, trích dẫn |
| `ai` | AI | Hội thoại, điều phối tool, đề xuất và phê duyệt, tóm tắt tiến độ |
| `github` | GIT | Kết nối repository, webhook, liên kết commit/PR với Card |
| `system-admin` | SYS | Quản trị tài khoản/Workspace, quota, AI kill switch, audit, giám sát job |

Việc có thư mục không đồng nghĩa chức năng đã triển khai. Các nhãn Core/mở rộng/AI/POC trong SRS vẫn phục vụ chia giai đoạn; base này chỉ chuẩn bị vị trí cho các nhóm đó.

Mỗi module có cùng cấu trúc, ví dụ:

```text
modules/workspaces/
  routes/index.ts              Express Router của module, hiện chưa có endpoint
  controllers/                Nhận request và trả response
  services/                   Use case, quy tắc nghiệp vụ, điều phối transaction
  repository/                 Truy vấn dữ liệu thuộc module
  dto/                        Kiểu request/response và schema kiểm tra đầu vào
  utils/                      Hàm tiện ích nội bộ module
```

## Quy ước mở rộng

- Luồng xử lý HTTP: `routes -> controllers -> services -> repository`. Controller không truy vấn database trực tiếp. Kiểm tra dữ liệu đầu vào tại biên HTTP; kiểm tra quyền và quy tắc nghiệp vụ ở service để worker và AI tool cũng áp dụng được.
- `config/` đọc/kiểm tra cấu hình; `infrastructure/` chứa client và adapter kết nối dịch vụ. Không tạo kết nối mạng ngay khi import cấu hình. Chưa chọn ORM hoặc thư viện Redis/BullMQ cho đợt này.
- Router tổng gắn từng module tại `/api/v1/<tên-module>`. Các router đang rỗng: ví dụ `/api/v1/workspaces` vẫn trả 404 cho đến khi có endpoint. Đường dẫn tài nguyên cụ thể sẽ được chốt khi làm nghiệp vụ.
- Khi thêm endpoint, viết controller/service/repository trong module rồi đăng ký tại `routes/index.ts` của module. Với ESM + NodeNext, dùng đuôi `.js` cho đường dẫn import tương đối trong file TypeScript.
- Module gọi nghiệp vụ module khác qua service/hợp đồng công khai; không truy cập thẳng repository của module khác. Không cần tạo base repository tổng quát khi chưa có nhu cầu dùng chung.
- `workers/processors/` gọi service module để xử lý tài liệu, email, thông báo hoặc webhook; `workers/schedulers/` đăng ký job định kỳ. Chỉ thêm entry point worker khi thực sự triển khai queue.
- GitHub OAuth đăng nhập thuộc `auth`; connector đọc repository/webhook thuộc `github`. Attachment của Card thuộc `cards`, không tự động trở thành tài liệu Knowledge Base.
- Sự kiện nghiệp vụ và quyền nhận cập nhật thuộc `collaboration` cùng module sở hữu dữ liệu; kết nối WebSocket thuộc `infrastructure/realtime`.

## Cập nhật vai trò từ thảo luận

- **Owner** là người tạo Workspace, có quyền tạo Board và chỉ định PM. Yêu cầu này thay thế giả định cũ trong SRS rằng người tạo Workspace tự động là PM.
- Các vai trò còn lại gồm **PM**, **Member**, **System Admin**. Phạm vi PM theo Board hay Workspace và số lượng PM sẽ được chốt trước khi làm schema/phân quyền; base không tự quyết định các điểm này.
- Chưa triển khai xác thực hoặc kiểm tra quyền trong base. System Admin không mặc định được đọc nội dung dự án theo SRS.

## Phạm vi hiện tại

Đã có TypeScript strict, Express, Hello World, router tổng và thư mục module. Các thư mục chưa có triển khai được giữ bằng `.gitkeep` để có thể đưa vào Git sau này. Chưa thêm API nghiệp vụ, schema/migration, kết nối dịch vụ, hệ thống logging, Docker hoặc CI/CD.
