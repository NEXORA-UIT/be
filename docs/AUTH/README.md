# AUTH — thiết kế và thứ tự triển khai

Phạm vi AUTH gồm đăng ký, đăng nhập email/mật khẩu, làm mới phiên, đăng xuất, đổi mật khẩu, quên/đặt lại mật khẩu, `GET /auth/me`, và đăng nhập Google/GitHub. Không có tính năng “change account”. Frontend là ứng dụng riêng. Phần JWT đã có code và [hướng dẫn manual check](manual-jwt.md). Google OAuth có [hướng dẫn test bằng Swagger](manual-google-oauth.md); GitHub OAuth thuộc bước tiếp theo.

Đăng ký email/mật khẩu dùng [link xác nhận email](email-verification-registration.md). `POST /api/v1/auth/register` chỉ lưu đăng ký chờ trong Redis và gửi Gmail; frontend gửi token về `POST /api/v1/auth/verify-registration` để tạo `User` và nhận JWT. Khi chưa có frontend, lấy token trực tiếp từ URL trong Gmail để manual test.

`PATCH /auth/me` (nhất là avatar) chưa triển khai trong bước JWT. Khi làm avatar, backend sẽ nhận upload và dùng Cloudinary; không nhận một URL tùy ý để lưu trực tiếp.

## Hiện trạng và ranh giới

- Backend là Express 5 + TypeScript strict. Router JWT đã gắn tại `/api/v1/auth`.
- `docs/api/openapi/` và `docs/api/endpoint-matrix.md` là hợp đồng API. Luồng JWT được bổ sung logout, forgot/reset password; liên kết OAuth sẽ cần cập nhật thêm trước bước OAuth.
- ERD AUTH gồm `User`, `RefreshToken`, `OAuthAccount`. `OAuthAccount` dùng định danh ổn định `(provider, providerAccountId)`; email không phải định danh của OAuth.
- `modules/auth` sở hữu nghiệp vụ; `src/config/auth.config.ts` chỉ chứa JWT secret và thời hạn token. PostgreSQL, Redis và email có các file `database/database.config.ts`, `redis/redis.config.ts`, `email/email.config.ts` riêng. `src/infrastructure/` chứa client kết nối. Compose ở `infrastructure/docker/` hiện chạy PostgreSQL và Redis, API chạy trên host. API container là bước sau.
- Code JWT tách theo `src/modules/auth/routes/` (khai báo endpoint), `controllers/` (HTTP), `dto/` (Zod schema), `services/` (nghiệp vụ) và một thư mục `repository/` (Prisma và Redis). Guard JWT nằm trong module AUTH; validation và xử lý lỗi dùng chung nằm trong `src/shared/middlewares/`. `utils/token.util.ts` xử lý JWT/hash/random token; `utils/user.mapper.ts` chuyển dữ liệu user sang response. Nghiệp vụ reset mật khẩu nằm trong service AUTH, còn gửi Gmail nằm tại `src/infrastructure/email/email.client.ts`. `src/infrastructure/database/` và `redis/` chỉ tạo client kết nối.
- GitHub OAuth đăng nhập thuộc AUTH. GitHub connector của Board thuộc module `github` và có quyền truy cập/tokens riêng.

## Quy ước code và xử lý lỗi

- Tách kết quả gọi hàm thành biến có tên rõ nghĩa trước khi truyền sang hàm khác; tránh viết `funcA(funcB(), c)` trong luồng xử lý.
- Lỗi AUTH được định nghĩa tập trung tại `src/modules/auth/utils/auth.errors.ts` (HTTP status, mã lỗi, thông báo). Service gọi `throw authErrors.accountLocked()`; mỗi lần gọi tạo một `AppError` mới. Middleware validation chuyển lỗi bằng `next(error)`; Express 5 chuyển lỗi từ async handler đến middleware xử lý lỗi.
- `src/shared/middlewares/error.middleware.ts` được gắn cuối `app.ts`, trả chung cấu trúc `{ success: false, error: { code, message, details } }`. JSON sai định dạng trả 400, body quá lớn trả 413; lỗi hệ thống chưa phân loại trả 500 với thông báo chung.

## Phiên và token

- Access token JWT có hạn **15 phút**, gửi qua `Authorization: Bearer`; refresh token có hạn **7 ngày**, phù hợp quy ước hiện có trong `docs/api/conventions.md`.
- Refresh token được xoay vòng khi gọi `/auth/refresh`. Client giữ token thô; backend chỉ lưu **hash SHA-256** trong bảng `RefreshToken` của PostgreSQL.
- JWT chỉ chứa `userId`, `refreshTokenId` (ID bản ghi `RefreshToken`) và `exp` (hết hạn). Backend ký và xác minh bằng HS256 với secret riêng cho access token Nexora; không dùng chung secret với ứng dụng hoặc loại token khác. Logout thu hồi phiên hiện tại; logout mọi thiết bị thu hồi mọi phiên của user. Mỗi request xác thực kiểm tra phiên còn hiệu lực trong PostgreSQL.
- Mật khẩu dùng thư viện `bcrypt` với cost 12. Refresh token được hash SHA-256 để tra cứu trong PostgreSQL; reset token được hash SHA-256 để tra cứu trong Redis.
- Token đặt lại mật khẩu là ngẫu nhiên, dùng một lần, lưu hash trong Redis với TTL; phản hồi forgot password không tiết lộ email có tồn tại hay không. Đổi hoặc đặt lại mật khẩu thu hồi các phiên cũ.
- Redis chỉ lưu đăng ký đang chờ xác nhận, reset token và số lần đăng nhập sai. Vòng đời refresh token không phụ thuộc Redis.

## OAuth và liên kết tài khoản

Đọc [thiết kế flow OAuth](oauth-login-design.md) trước, sau đó xem chi tiết chính sách tại [oauth-account-linking.md](oauth-account-linking.md). Quy tắc chính: tìm theo `(provider, providerAccountId)` trước. Với Google, lần đầu có thể tự liên kết vào `User` cùng email **chỉ khi Google xác nhận email đã được xác minh**; những lần sau nhận diện bằng Google `sub`. GitHub dùng chính sách liên kết chủ động riêng.

Google OAuth bắt đầu tại `POST /auth/oauth/google/start`. Frontend giữ `loginToken` trong `sessionStorage`, mở `authorizationUrl`, so sánh callback `state` rồi chỉ gửi `code` và `state` tới `POST /auth/oauth/google/callback`. Backend lấy redirect URI cố định từ file môi trường, dùng state một lần trong Redis và kiểm tra PKCE trước khi cấp JWT Nexora. GitHub sẽ dùng cùng khung flow ở bước riêng.

## Các bước triển khai để review riêng

Mỗi bước là một branch `feature/...`, một PR vào `staging`, kèm test và cập nhật tài liệu tương ứng. Khi bước trước còn chưa vào `staging`, branch mới có thể tạm dựa trên commit đã review; đồng bộ lại với `staging` trước PR. Bro tự push branch. Chỉ bắt đầu code bước kế tiếp sau khi bro review plan của bước đó.

| Bước                 | Kết quả có thể review và test độc lập                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Thiết kế AUTH     | Tài liệu này, chính sách liên kết OAuth, ghi rõ khác biệt với API contract hiện có.                                                                            |
| 1. Dịch vụ local     | Compose cho PostgreSQL và Redis tại `infrastructure/docker/`; biến môi trường mẫu, health check và cách chạy local. [Plan bước 1](plans/01-local-services.md). |
| 2. Dữ liệu AUTH      | Prisma và migration ba bảng AUTH theo ERD; test ràng buộc unique và quan hệ. [Plan bước 2](plans/02-auth-data.md).                                             |
| 3. Đăng ký/đăng nhập | Register, login, `me`, hash mật khẩu, validation, JWT access; test service và HTTP.                                                                            |
| 4. Phiên             | Refresh rotation, logout phiên hiện tại/tất cả phiên bằng PostgreSQL; test replay và token hết hạn.                                                            |
| 5. Mật khẩu          | Change password, forgot/reset password, adapter mail; test token một lần và không lộ email.                                                                    |
| 6. API container     | Dockerfile cho API, nối API với hai dịch vụ qua Compose; smoke test HTTP.                                                                                      |
| 7. Google OAuth      | State, code exchange, đăng nhập/tạo tài khoản, chính sách email trùng và liên kết; test bằng provider giả.                                                     |
| 8. GitHub OAuth      | Cùng chính sách, xử lý email GitHub thiếu/chưa xác minh; test bằng provider giả.                                                                               |

Trước khi triển khai endpoint AUTH, chốt hợp đồng API với frontend cho token transport, OAuth `state`, logout và reset password. Hiện README trên `staging` đã ghi **Prisma ORM** là công nghệ dự kiến; bước 2 dùng lựa chọn đó.

## Client và cách đặt tên token

- Prisma bật log query, warn, error; query gồm cả SELECT, INSERT, UPDATE, DELETE.
- Redis export singleton redis; server gọi redis.connect() một lần trước khi nhận request, repository dùng trực tiếp redis.
- `token.service.ts` quản lý cấp token, refresh và thu hồi. `refreshTokenId` là ID bản ghi; `refreshToken` là chuỗi bí mật trả cho client.
