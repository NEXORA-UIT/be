# Nexora Backend

Dự án Backend cho nền tảng quản lý dự án thông minh tích hợp AI Agent (**Nexora**). Hệ thống được phát triển theo kiến trúc Modular Monolith trên nền tảng Node.js, Express và TypeScript.

Tài liệu này mô tả tổng quan kiến trúc, hiện trạng triển khai, quy ước kỹ thuật và hướng dẫn vận hành cho đồ án tốt nghiệp.

---

## Thông tin Dự án & Nhóm thực hiện

- **Tên đồ án:** Hệ thống Quản lý Dự án Thông minh Tích hợp Trợ lý Trí tuệ Nhân tạo (Intelligent Project Management System Integrated with AI Agent).
- **Môn học:** Đồ án 1.
- **Thành viên thực hiện:**

| Họ và tên      | Mã số sinh viên | Vai trò             |
| :------------- | :-------------: | :------------------ |
| Phan Gia Đạt   |    24520287     | Sinh viên thực hiện |
| Nguyễn Gia Bảo |    24520168     | Sinh viên thực hiện |

---

## 1. Tổng quan Dự án

Nexora là một nền tảng quản lý dự án đa dụng (general-purpose project management platform) dành cho các đội nhóm, không giới hạn trong phạm vi dự án công nghệ thông tin. Hệ thống cung cấp không gian làm việc cộng tác đa người dùng, bảng công việc Kanban, theo dõi tiến độ, cơ sở tri thức (Knowledge Base) và tích hợp Trợ lý AI (AI Agent) hỗ trợ lập kế hoạch, tóm tắt và thực hiện tác vụ với sự phê duyệt của con người (Human-in-the-Loop).

Kho lưu trữ này (`be`) là phần **Backend** của hệ thống, chịu trách nhiệm cung cấp toàn bộ REST API, đồng bộ sự kiện thời gian thực (WebSocket), quản lý dữ liệu bền vững và điều phối các tác vụ nền.

---

## 2. Hiện trạng Dự án (Project Status)

Dự án hiện đang ở giai đoạn **thiết lập nền tảng kỹ thuật và hoàn thiện hợp đồng đặc tả API (API Contract Documentation)**.

### 2.1. Đã triển khai trong mã nguồn (Currently Implemented)

- Cấu hình TypeScript nghiêm ngặt (`strict: true`, module resolution `NodeNext`, chuẩn ESM).
- Ứng dụng nền tảng Express 5 và điểm cuối kiểm tra trạng thái máy chủ `GET /` (`Hello World!`).
- Cấu trúc khung định tuyến phân tầng modular monolith (Router tổng `/api/v1` gắn kết 10 module rỗng).
- Tích hợp Swagger UI tại đường dẫn `/api/docs` để duyệt và kiểm tra trực quan hợp đồng API.
- Bộ tài liệu hợp đồng API đầy đủ và chuẩn hóa trong thư mục `docs/api/`.

### 2.2. Đặc tả tài liệu (Documentation Only)

- **Đặc tả WebSocket Realtime (Phase 6):** Bản hợp đồng chuẩn hóa cấu trúc gói tin, sự kiện Kanban và quản lý phòng kết nối tại `docs/api/websocket.md`.
- **Đặc tả OpenAPI 3.0.3:** Toàn bộ 72 điểm cuối REST API và 123 DTO schema được tài liệu hóa chi tiết tại `docs/api/openapi.yaml`.

### 2.3. Hạ tầng dự kiến trong tương lai (Planned / Future Infrastructure)

Các công nghệ sau đây **chưa được cài đặt mã nguồn hoặc khởi tạo kết nối** trong repository; các thư mục hiện chỉ là khung giữ chỗ bằng `.gitkeep`:

- Cơ sở dữ liệu quan hệ: PostgreSQL và Prisma ORM.
- Tìm kiếm ngữ nghĩa: Phần mở rộng pgvector.
- Bộ nhớ đệm & Hàng đợi: Redis và BullMQ workers.
- Lưu trữ tệp tin: Cloudflare R2 hoặc Cloudinary.
- Xác thực mở rộng: Google OAuth 2.0 và GitHub OAuth 2.0.
- Trí tuệ nhân tạo: Pipeline RAG, tích hợp LLM, Langfuse tracing, Apache Tika document parser.
- Tích hợp kỹ thuật: GitHub repository connector và webhook processor.
- Runtime kết nối mạng thời gian thực: WebSocket runtime (`ws` hoặc Socket.IO).

---

## 3. Ngăn xếp Công nghệ (Technology Stack)

| Công nghệ                        |    Trạng thái     | Mục đích sử dụng                                                        |
| :------------------------------- | :---------------: | :---------------------------------------------------------------------- |
| **Node.js (>=22)**               |   Đang sử dụng    | Môi trường runtime JavaScript phía máy chủ                              |
| **pnpm**                         |   Đang sử dụng    | Trình quản lý gói phụ thuộc hiệu năng cao                               |
| **TypeScript (~5.9)**            |   Đang sử dụng    | Ngôn ngữ lập trình chính với cấu hình tĩnh nghiêm ngặt (`strict: true`) |
| **Express (5.1)**                |   Đang sử dụng    | Web framework nền tảng cho hệ thống REST API                            |
| **Swagger UI Express (5.0)**     |   Đang sử dụng    | Giao diện hiển thị và tương tác trực quan với tài liệu OpenAPI          |
| **YAML parser (2.9)**            |   Đang sử dụng    | Bộ nạp tệp đặc tả `openapi.yaml` vào bộ nhớ máy chủ                     |
| **tsx (4.20)**                   |   Đang sử dụng    | Công cụ thực thi TypeScript trực tiếp hỗ trợ hot reload khi phát triển  |
| **PostgreSQL**                   | Dự kiến (Planned) | Hệ quản trị cơ sở dữ liệu quan hệ lưu trữ dữ liệu bền vững              |
| **Prisma ORM**                   | Dự kiến (Planned) | Bộ công cụ quản lý lược đồ dữ liệu, migration và truy vấn               |
| **pgvector**                     | Dự kiến (Planned) | Vector database mở rộng lưu trữ embedding cho hệ thống RAG              |
| **Redis**                        | Dự kiến (Planned) | Bộ nhớ tạm (caching), quản lý phiên và điều phối phân tán               |
| **BullMQ**                       | Dự kiến (Planned) | Hệ thống quản lý hàng đợi và tác vụ nền bất đồng bộ                     |
| **Cloudinary / R2**              | Dự kiến (Planned) | Lưu trữ tệp đính kèm, ảnh đại diện và tài liệu Knowledge Base           |
| **OAuth 2.0 (Google, GitHub)**   | Dự kiến (Planned) | Đăng nhập một chạm tiện lợi và bảo mật                                  |
| **LLM Orchestration / Langfuse** | Dự kiến (Planned) | Điều phối Trợ lý AI, theo dõi token và giám sát cuộc gọi mô hình        |
| **Apache Tika**                  | Dự kiến (Planned) | Trích xuất văn bản từ tài liệu tải lên (PDF, DOCX) phục vụ RAG          |
| **WebSocket Runtime**            | Dự kiến (Planned) | Thư viện socket thời gian thực cho tính năng cộng tác bảng Kanban       |

---

## 4. Tài liệu Hợp đồng API (API Documentation)

Toàn bộ hợp đồng giao tiếp giữa Frontend và Backend đã được hoàn thiện trong thư mục `docs/api/`:

- **Swagger UI:** Có sẵn trực tiếp khi khởi động máy chủ tại:
  - Tuyến đường (Route): `/api/docs`
  - Địa chỉ cục bộ: `http://localhost:3000/api/docs`
- **Tệp đặc tả OpenAPI:** `docs/api/openapi.yaml` (Quy chuẩn OpenAPI 3.0.3 đầy đủ dữ liệu, phân quyền, OCC và mã lỗi).
- **Ma trận điểm cuối:** `docs/api/endpoint-matrix.md` (Đối chiếu 16 cột chuẩn cho 32 Use Case theo tài liệu SRS).
- **Quy ước API & Xử lý lỗi:** `docs/api/conventions.md` (Quy định cấu trúc phản hồi JSON chuẩn, mã lỗi chuẩn hóa, phân trang và kiểm soát tương tranh lạc quan OCC).
- **Đặc tả WebSocket Realtime:** `docs/api/websocket.md` (Đặc tả các gói tin sự kiện cộng tác thời gian thực).
- **Báo cáo kiểm định WebSocket:** `docs/api/websocket-validation.md` (Báo cáo thẩm định tính nhất quán của hợp đồng Phase 6).

### Lưu ý về Giai đoạn Phase 6 (WebSocket Documentation)

- Phase 6 **hoàn toàn là tài liệu hóa hợp đồng đặc tả**.
- **Nguyên tắc thẩm quyền:** REST API vẫn là nguồn thẩm quyền duy nhất thực hiện biến đổi dữ liệu bền vững (Create, Update, Move, Archive, Delete). WebSocket chỉ đóng vai trò kênh lan truyền thông báo sự kiện một chiều từ máy chủ tới các máy khách trong cùng phòng Bảng (`board:{boardId}`).
- **Chưa có mã nguồn WebSocket runtime:** Chưa có thư viện kết nối thời gian thực nào được cài đặt vào mã nguồn trong giai đoạn này.

---

## 5. Hướng dẫn Chạy Dự án (Running the Project)

### 5.1. Yêu cầu Môi trường

- **Node.js:** Phiên bản `>= 22.0.0`
- **Package Manager:** `pnpm` (khuyến nghị phiên bản 9 trở lên)

### 5.2. Các Lệnh Thực thi

Cài đặt các gói phụ thuộc:

```sh
pnpm install
```

Khởi chạy máy chủ ở chế độ phát triển (Hot reload):

```sh
pnpm dev
```

Sau khi khởi động, truy cập:

- Kiểm tra máy chủ: `http://localhost:3000/` (Phản hồi: `Hello World!`)
- Giao diện Swagger UI: `http://localhost:3000/api/docs`

Kiểm tra kiểu dữ liệu TypeScript (Strict Typecheck):

```sh
pnpm typecheck
```

Biên dịch dự án sang mã nguồn JavaScript:

```sh
pnpm build
```

Khởi chạy bản biên dịch trong thư mục `dist/`:

```sh
pnpm start
```

_Lưu ý: Biến môi trường `PORT` cho phép thay đổi cổng lắng nghe của máy chủ (mặc định là `3000`). Ở giai đoạn hiện tại, dự án không yêu cầu kết nối cơ sở dữ liệu hay khóa API bên ngoài để chạy._

### 5.3. PostgreSQL và Redis local bằng Docker

Docker Compose cho hai dịch vụ nằm tại `infrastructure/docker/compose.yaml`. Backend hiện vẫn chạy trên host bằng `pnpm dev` và chưa kết nối hai dịch vụ này. Cần Docker Desktop hoặc Docker daemon đang chạy.

Trong PowerShell, tại gốc repo:

```powershell
Copy-Item .env.example .env
```

Sửa `POSTGRES_PASSWORD` trong `.env` thành mật khẩu local của bạn. File `.env` đã được Git bỏ qua. Nếu cổng 5432 hoặc 6379 đang bận, đổi `POSTGRES_PORT` hoặc `REDIS_PORT` trong file này.

```powershell
docker compose --env-file .env -f infrastructure/docker/compose.yaml up -d
docker compose --env-file .env -f infrastructure/docker/compose.yaml ps
docker compose --env-file .env -f infrastructure/docker/compose.yaml exec postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose --env-file .env -f infrastructure/docker/compose.yaml exec redis redis-cli ping
```

`ps` cần hiển thị cả `postgres` và `redis` ở trạng thái `healthy`; lệnh Redis trả `PONG`. Dừng các container khi không dùng:

```powershell
docker compose --env-file .env -f infrastructure/docker/compose.yaml down
```

`down` giữ hai named volumes nên dữ liệu còn sau khi khởi động lại. Chỉ dùng `down --volumes` khi muốn xóa dữ liệu local.

---

## 6. Cấu trúc Thư mục Backend (Backend Structure)

Dự án được tổ chức theo cấu trúc Modular Monolith:

```text
src/
  app.ts                       Khởi tạo ứng dụng Express, gắn Swagger và Router tổng
  server.ts                    Điểm khởi động HTTP server lắng nghe theo appConfig.port
  routes/
    index.ts                   Tổng hợp và gắn kết các router module dưới tiền tố /api/v1
  config/
    app.config.ts              Cấu hình cổng HTTP hiện tại
    database/                  [Giữ chỗ] Cấu hình PostgreSQL, pgvector trong tương lai
    redis/                     [Giữ chỗ] Cấu hình Redis trong tương lai
    bullmq/                    [Giữ chỗ] Cấu hình queue, retry, backoff trong tương lai
    email/                     [Giữ chỗ] Cấu hình SMTP trong tương lai
    storage/                   [Giữ chỗ] Cấu hình R2, Cloudinary trong tương lai
    oauth/                     [Giữ chỗ] Cấu hình Google/GitHub OAuth trong tương lai
    ai/                        [Giữ chỗ] Cấu hình LLM, embedding, Langfuse trong tương lai
    document-parser/           [Giữ chỗ] Cấu hình Apache Tika trong tương lai
  infrastructure/
    database/                  [Giữ chỗ] DB client, migration, truy cập hạ tầng dữ liệu
    redis/                     [Giữ chỗ] Redis client, cache, pub/sub
    bullmq/                    [Giữ chỗ] Queue connection, producer và hợp đồng job
    email/                     [Giữ chỗ] SMTP adapter
    storage/                   [Giữ chỗ] R2/Cloudinary adapter
    oauth/                     [Giữ chỗ] OAuth provider adapter
    ai/                        [Giữ chỗ] LLM, embedding và tracing adapter
    document-parser/           [Giữ chỗ] Tika adapter
    github/                    [Giữ chỗ] GitHub API client
    realtime/                  [Giữ chỗ] WebSocket transport và quản lý kết nối phòng
  modules/
    auth/                      Module xác thực & hồ sơ người dùng
    workspaces/                Module không gian làm việc & thành viên
    boards/                    Module bảng công việc & danh sách cột (List)
    cards/                     Module thẻ việc, nhãn, checklist công việc
    collaboration/             Module bình luận, thông báo & lịch sử hoạt động
    planning/                  Module lịch biểu, phụ thuộc thẻ & tiến độ
    knowledge-base/            Module quản lý tài liệu dự án & tìm kiếm RAG
    ai/                        Module trợ lý AI hội thoại & phê duyệt đề xuất
    github/                    Module tích hợp kho lưu trữ GitHub
    system-admin/              Module quản trị hệ thống nền tảng
  shared/
    utils/                     Hàm tiện ích dùng chung độc lập nghiệp vụ
    middlewares/               Express middleware dùng chung (xác thực, lỗi, phân quyền)
    types/                     Kiểu dữ liệu TypeScript dùng chung
    errors/                    Lớp định nghĩa lỗi chuẩn hóa của hệ thống
  workers/
    processors/                Điểm xử lý job bất đồng bộ, gọi service của module
    schedulers/                Đăng ký lịch trình chạy job định kỳ
```

_Lưu ý: Các thư mục đánh dấu `[Giữ chỗ]` hiện chứa tệp `.gitkeep` để duy trì cấu trúc khung kiến trúc chuẩn, chưa chứa logic kết nối runtime._

---

## 7. Danh mục Module & Phạm vi Nghiệp vụ Dự kiến

Việc hiện diện thư mục module không đồng nghĩa nghiệp vụ đã được triển khai. Bảng dưới đây định vị trách nhiệm khi bước vào giai đoạn cài đặt mã nguồn:

| Module           | Nhóm SRS | Trách nhiệm khi triển khai nghiệp vụ                                                            |
| :--------------- | :------: | :---------------------------------------------------------------------------------------------- |
| `auth`           |   AUTH   | Đăng ký, đăng nhập cục bộ, cấp phát JWT, làm mới token, Google/GitHub OAuth                     |
| `workspaces`     |    WS    | Ranh giới Workspace, quản lý thành viên, lời mời, phân quyền Owner                              |
| `boards`         |  BOARD   | Vòng đời Board dự án, trạng thái cột List, phân công quyền PM cho từng Board                    |
| `cards`          |   CARD   | Thẻ công việc, checklist tác vụ, hạn chót, nhãn màu, tệp đính kèm, kéo thả thứ tự               |
| `collaboration`  |   COL    | Bình luận trao đổi, thông báo in-app, nhật ký hoạt động, sự kiện thời gian thực                 |
| `planning`       |   PLAN   | Lịch biểu (Calendar), Inbox ghi chú nhanh (Quick Notes), liên kết phụ thuộc thẻ                 |
| `knowledge-base` |    KB    | Lưu trữ tài liệu theo Board, xử lý trích xuất văn bản, lập chỉ mục vector RAG                   |
| `ai`             |    AI    | Trợ lý hội thoại ngữ cảnh, điều phối công cụ (Tools), tóm tắt tiến độ, cơ chế Human-in-the-Loop |
| `github`         |   GIT    | Kết nối kho GitHub, tiếp nhận webhook sự kiện commit/pull request gắn với Card                  |
| `system-admin`   |   SYS    | Quản trị nền tảng, khóa tài khoản, đóng băng Workspace, kill switch AI, kiểm toán               |

Mỗi module được thiết kế đồng nhất theo cấu trúc nội bộ:

```text
modules/<tên-module>/
  routes/index.ts              Express Router của module
  controllers/                Tiếp nhận HTTP request, gọi service và trả response
  services/                   Xử lý logic nghiệp vụ, quy tắc dữ liệu, điều phối transaction
  repository/                 Truy vấn cơ sở dữ liệu thuộc phạm vi module
  dto/                        Định nghĩa kiểu dữ liệu DTO và schema kiểm tra đầu vào
  utils/                      Hàm tiện ích nội bộ của module
```

---

## 8. Quy ước Phát triển (Development Conventions)

1. **Luồng Xử lý Dữ liệu Phân tầng:**
   `routes -> controllers -> services -> repository`
   Controller chỉ chịu trách nhiệm nhận/trả HTTP; Service đảm nhận toàn bộ quy tắc nghiệp vụ, kiểm tra quyền và giao dịch dữ liệu; Repository thực hiện truy vấn trực tiếp.
2. **Quy tắc Import ESM:**
   Hệ thống sử dụng ECMAScript Modules (`"type": "module"`). Toàn bộ các câu lệnh import tương đối giữa các tệp nội bộ bắt buộc phải có phần mở rộng `.js` (ví dụ: `import { appConfig } from './config/app.config.js';`).
3. **Tính Đóng gói của Module:**
   Một module chỉ được phép gọi sang module khác thông qua lớp `Service` hoặc hợp đồng công khai được cung cấp; tuyệt đối không truy cập trực tiếp vào `Repository` của module khác.
4. **Xử lý Tác vụ Nền (Workers):**
   `workers/processors/` tiếp nhận job từ hàng đợi BullMQ và ủy quyền xử lý cho các module service liên quan (xử lý tài liệu, gửi email, tổng hợp dữ liệu).
5. **Cộng tác Thời gian thực (Realtime Events):**
   Mọi biến đổi trạng thái thẻ việc, danh sách và bình luận được kích hoạt tự động từ tầng REST service sau khi commit transaction thành công, đẩy sự kiện qua WebSocket tới phòng bảng đích `board:{boardId}`.

---

## 9. Cập nhật Mô hình Vai trò & Phân quyền (RBAC)

Dựa trên kết quả thảo luận kỹ thuật và chuẩn hóa yêu cầu:

- **Workspace Owner:** Người khởi tạo Workspace có toàn quyền sở hữu Workspace đó, quản lý thành viên và chỉ định PM cho từng Board.
- **Board PM (Project Manager):** Mỗi Board có 1 PM chịu trách nhiệm quản lý trực tiếp các thành viên và quy trình công việc trong phạm vi Board đó.
- **Board Member:** Thành viên tham gia thực hiện nhiệm vụ, trao đổi và cập nhật thẻ việc trong Board được phân quyền.
- **System Admin:** Quản trị viên cấp cao của toàn hệ thống, quản lý tài khoản và hạn ngạch, không mặc định truy cập vào nội dung dự án riêng tư của người dùng.
