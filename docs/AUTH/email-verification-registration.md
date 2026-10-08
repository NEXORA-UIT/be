# Đăng ký bằng link xác nhận email

## Mục tiêu

Tài khoản email/mật khẩu chỉ được tạo sau khi người dùng bấm link xác nhận trong Gmail. Trước thời điểm xác nhận, PostgreSQL chưa có bản ghi `User` và backend chưa cấp access token hoặc refresh token.

Frontend và backend là hai ứng dụng riêng. Link trong Gmail mở trang frontend; frontend đọc token trên URL rồi gửi token về backend để hoàn tất đăng ký.

## Bắt đầu đăng ký

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "StartPass123!",
  "fullName": "Nexora User"
}
```

Backend thực hiện theo thứ tự:

1. Kiểm tra Gmail đã được cấu hình.
2. Chuẩn hóa email về chữ thường và kiểm tra email chưa thuộc về `User` nào.
3. Hash password bằng bcrypt; không lưu password thô.
4. Tạo registration token ngẫu nhiên và hash token bằng SHA-256.
5. Lưu email, password hash và full name vào Redis với key tạo từ token hash.
6. Đặt TTL 15 phút cho dữ liệu đăng ký đang chờ.
7. Gửi link xác nhận đến Gmail của người dùng.
8. Trả `202 Accepted`; chưa tạo `User` và chưa cấp JWT.

Response:

```json
{
  "success": true,
  "message": "Kiểm tra email để hoàn tất đăng ký"
}
```

Key Redis:

```text
pending-registration:<sha256-token>
```

Value chỉ chứa:

```json
{
  "email": "user@example.com",
  "passwordHash": "<bcrypt-hash>",
  "fullName": "Nexora User"
}
```

Raw registration token chỉ xuất hiện trong link gửi qua email.

Nếu gửi Gmail thất bại, backend xóa pending registration vừa tạo và trả lỗi. Gửi lại `POST /register` tạo một link mới; khi một link tạo tài khoản thành công, các link còn lại của cùng email không thể tạo thêm tài khoản vì `User.email` là unique.

## Link xác nhận

Backend tạo link từ biến môi trường `AUTH_VERIFY_URL`:

```env
AUTH_VERIFY_URL=http://localhost:5173/verify-email
```

Email nhận được link:

```text
http://localhost:5173/verify-email?token=<raw-registration-token>
```

Frontend đọc query parameter `token` và gọi endpoint hoàn tất đăng ký. Frontend chưa tồn tại không chặn manual test: sao chép token trực tiếp từ URL Gmail rồi gửi bằng Swagger UI.

## Hoàn tất đăng ký

```http
POST /api/v1/auth/verify-registration
Content-Type: application/json

{
  "token": "<raw-registration-token>"
}
```

Backend thực hiện theo thứ tự:

1. Hash token nhận được bằng SHA-256.
2. Đọc dữ liệu đăng ký đang chờ từ Redis.
3. Kiểm tra lại email chưa được đăng ký trong lúc người dùng chờ xác nhận.
4. Tạo `User` trong PostgreSQL với trạng thái `ACTIVE`.
5. Xóa dữ liệu đăng ký đang chờ khỏi Redis.
6. Cấp access token và refresh token như login hiện tại.
7. Trả `201 Created` cùng user và token.

Nếu tạo `User` thất bại, backend không xóa dữ liệu Redis để người dùng có thể thử lại khi token còn hạn. Unique constraint của `User.email` vẫn là lớp bảo vệ cuối khi có hai request xác nhận đồng thời.

## Lỗi

| Trường hợp                         | HTTP status | Error code                   |
| ---------------------------------- | ----------: | ---------------------------- |
| Email đã có tài khoản              |       `409` | `EMAIL_TAKEN`                |
| Token sai, hết hạn hoặc đã sử dụng |       `400` | `INVALID_REGISTRATION_TOKEN` |
| Gmail chưa được cấu hình           |       `503` | `MAIL_NOT_CONFIGURED`        |
| Body không hợp lệ                  |       `400` | `VALIDATION_ERROR`           |

Sau khi xác nhận thành công, gọi lại cùng token trả `400 INVALID_REGISTRATION_TOKEN`.

## Manual test khi chưa có frontend

1. Mở Swagger UI tại `http://localhost:3000/api/docs` và Prisma Studio bằng `pnpm db:studio`.
2. Trong Swagger, mở `POST /auth/register`, bấm **Try it out** rồi **Execute**; API phải trả `202`.
3. Kiểm tra Prisma Studio: vẫn chưa có `User`.
4. Mở RedisInsight: có `pending-registration:<hash>` và TTL không quá 15 phút; value không chứa password hoặc raw token.
5. Mở Gmail, sao chép token trong query parameter của link xác nhận.
6. Trong Swagger, mở `POST /auth/verify-registration`, nhập token rồi bấm **Execute**; API phải trả `201` và token đăng nhập.
7. Kiểm tra Prisma Studio: `User` đã được tạo và password chỉ tồn tại dưới dạng bcrypt hash.
8. Kiểm tra RedisInsight: pending registration đã bị xóa. Kiểm tra Prisma Studio: bảng `RefreshToken` có phiên mới.
9. Trong Swagger, gọi lại endpoint xác nhận bằng token cũ; API phải trả `400 INVALID_REGISTRATION_TOKEN`.
10. Tạo đăng ký mới nhưng không xác nhận, đợi quá 15 phút rồi xác nhận trong Swagger; API phải trả `400 INVALID_REGISTRATION_TOKEN` và không tạo `User`.

## Ngoài phạm vi bước này

- Frontend trang `/verify-email`.
- Welcome email sau khi tạo tài khoản.
- Google OAuth và GitHub OAuth; provider chịu trách nhiệm xác minh email theo chính sách OAuth riêng.
- Thêm trạng thái `PENDING` vào bảng `User`.
