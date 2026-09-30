# AUTH — thiết kế và thứ tự triển khai

Tài liệu này là **đề xuất để review trước khi code**. Phạm vi AUTH gồm đăng ký, đăng nhập email/mật khẩu, làm mới phiên, đăng xuất, đổi mật khẩu, quên/đặt lại mật khẩu, `GET /auth/me`, và đăng nhập Google/GitHub. Không có tính năng “change account”. Frontend là ứng dụng riêng.

## Hiện trạng và ranh giới

- Backend là Express 5 + TypeScript strict, router AUTH đã gắn tại `/api/v1/auth` nhưng chưa có handler.
- `docs/api/openapi.yaml` và `docs/api/endpoint-matrix.md` trên `staging` là hợp đồng API đang có. Chúng chưa mô tả logout, forgot/reset password và liên kết OAuth một cách đầy đủ; cần cập nhật hợp đồng trước khi triển khai các endpoint đó.
- ERD AUTH gồm `User`, `RefreshToken`, `OAuthAccount`. `OAuthAccount` dùng định danh ổn định `(provider, providerAccountId)`; email không phải định danh của OAuth.
- `modules/auth` sở hữu nghiệp vụ; `config/database`, `config/redis`, `config/oauth`, `config/email` đọc và kiểm tra cấu hình; `src/infrastructure/` chứa các client/adapter tương ứng. Dockerfile và Compose đặt tại `infrastructure/docker/` ở gốc repo, chạy API, PostgreSQL và Redis. Dịch vụ gửi mail cần một adapter để test được mà không gửi email thật.
- GitHub OAuth đăng nhập thuộc AUTH. GitHub connector của Board thuộc module `github` và có quyền truy cập/tokens riêng.

## Phiên và token

- Access token JWT có hạn **15 phút**, gửi qua `Authorization: Bearer`; refresh token có hạn **7 ngày**, phù hợp quy ước hiện có trong `docs/api/conventions.md`.
- Refresh token được xoay vòng khi gọi `/auth/refresh`. Chỉ lưu **hash** của token ở `RefreshToken` và Redis, không lưu token thô; `RefreshToken` là dấu vết bền vững, Redis phục vụ kiểm tra phiên/thu hồi nhanh và token dùng một lần.
- Logout thu hồi phiên hiện tại; logout mọi thiết bị thu hồi mọi phiên của user. Việc thu hồi access token trước hạn cần `jti`/trạng thái phiên trong Redis, với TTL không vượt thời hạn còn lại của access token.
- Token đặt lại mật khẩu là ngẫu nhiên, dùng một lần, lưu hash trong Redis với TTL; phản hồi forgot password không tiết lộ email có tồn tại hay không. Đổi hoặc đặt lại mật khẩu thu hồi các phiên cũ.
- Nếu Redis không sẵn sàng, các thao tác cần kiểm tra/thu hồi token phải báo lỗi có kiểm soát thay vì mặc nhiên chấp nhận token.

## OAuth và liên kết tài khoản

Xem [oauth-account-linking.md](oauth-account-linking.md). Quy tắc chính: tìm theo `(provider, providerAccountId)` trước; **không tự liên kết tài khoản chỉ vì email trùng**. Người dùng đã có tài khoản phải đăng nhập tài khoản đó rồi chủ động liên kết với provider.

Hợp đồng hiện có nhận `code` qua `POST /auth/oauth/google` hoặc `/github` và trả token trong JSON. Frontend nhận authorization code ở redirect URI của nó rồi gửi code về backend để đổi. Trước khi code OAuth, cần bổ sung cơ chế cấp/kiểm tra `state` dùng một lần trong Redis và giới hạn redirect URI vào allowlist; điều này là thay đổi hợp đồng cần frontend review.

## Các lát triển khai để review riêng

Mỗi lát là một branch `feature/...` từ `staging`, một PR vào `staging`, kèm test và cập nhật tài liệu tương ứng. Chỉ bắt đầu lát kế tiếp sau khi bro review lát trước.

| Lát | Kết quả có thể review và test độc lập |
| --- | --- |
| 0. Thiết kế AUTH | Tài liệu này, chính sách liên kết OAuth, ghi rõ khác biệt với API contract hiện có. |
| 1. Docker và cấu hình | Compose cho API/PostgreSQL/Redis tại `infrastructure/docker/`; biến môi trường mẫu, health check và cách chạy local. |
| 2. Dữ liệu AUTH | Prisma và migration ba bảng AUTH theo ERD; test ràng buộc unique và quan hệ. |
| 3. Đăng ký/đăng nhập | Register, login, `me`, hash mật khẩu, validation, JWT access; test service và HTTP. |
| 4. Phiên | Refresh rotation, logout phiên hiện tại/tất cả phiên, Redis thu hồi token; test replay và token hết hạn. |
| 5. Mật khẩu | Change password, forgot/reset password, adapter mail; test token một lần và không lộ email. |
| 6. Google OAuth | State, code exchange, đăng nhập/tạo tài khoản, chính sách email trùng và liên kết; test bằng provider giả. |
| 7. GitHub OAuth | Cùng chính sách, xử lý email GitHub thiếu/chưa xác minh; test bằng provider giả. |

Trước lát 1, chốt hợp đồng API với frontend cho token transport, OAuth `state`, logout và reset password. Hiện README trên `staging` đã ghi **Prisma ORM** là công nghệ dự kiến; lát 2 nên dùng lựa chọn đó nếu nhóm không đổi quyết định.
