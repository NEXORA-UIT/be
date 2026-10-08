# Manual check AUTH JWT bằng Swagger

Chạy từ gốc `backend`. PostgreSQL và Redis chạy trong Docker, API chạy trên host. Không đưa `.env.local`, access token, refresh token hoặc reset token lên Git.

## 1. Cấu hình và khởi động

Đăng ký và quên mật khẩu qua Gmail cần các biến sau trong `.env.local`:

```env
GMAIL_USER=your-account@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
AUTH_VERIFY_URL=http://localhost:5173/verify-email
AUTH_RESET_URL=http://localhost:5173/reset-password
```

Gmail App Password yêu cầu bật xác minh hai bước. Frontend chưa tồn tại nên link có thể không mở được; vẫn có thể sao chép token trên URL để gửi bằng Swagger.

```powershell
pnpm install
pnpm infra:up:local
docker compose --env-file .env.local -f infrastructure/docker/compose.yaml ps
pnpm db:validate
pnpm db:migrate
pnpm db:generate
pnpm test
pnpm dev:local
```

Hai container phải `healthy`. Nếu cổng 5432 bị chiếm, đổi `POSTGRES_PORT` trong `.env.local` trước khi chạy Compose.

Mở terminal riêng cho Prisma Studio:

```powershell
pnpm db:studio
```

Mở các công cụ:

- Swagger UI: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- Prisma Studio: URL được in bởi `pnpm db:studio`
- RedisInsight: kết nối `127.0.0.1:6379`

Mọi request API bên dưới đều thực hiện trong Swagger bằng nút **Try it out** → **Execute**.

## 2. Register và xác nhận Gmail

### 2.1. Gửi yêu cầu đăng ký

Mở `POST /auth/register` và nhập:

```json
{
  "email": "your-real-email@gmail.com",
  "password": "StartPass123!",
  "fullName": "Manual Tester"
}
```

Kết quả cần kiểm tra:

1. API trả `202` với message yêu cầu kiểm tra email.
2. Prisma Studio chưa có `User` cho email vừa nhập.
3. RedisInsight có `pending-registration:<hash>` với TTL tối đa 15 phút.
4. Redis chỉ chứa email, full name và bcrypt password hash; không chứa password hoặc token thô.

Nếu Gmail chưa cấu hình, API trả `503 MAIL_NOT_CONFIGURED`. Nếu email đã có tài khoản, API trả `409 EMAIL_TAKEN`.

### 2.2. Xác nhận đăng ký

Mở Gmail, sao chép giá trị `token` trên link xác nhận. Sau đó mở `POST /auth/verify-registration`:

```json
{
  "token": "token-lấy-từ-link-gmail"
}
```

Kết quả cần kiểm tra:

1. API trả `201` cùng `accessToken`, `refreshToken`, `expiresIn` và `user`.
2. Prisma Studio lúc này mới có `User`; `passwordHash` là bcrypt hash.
3. Prisma Studio có một `RefreshToken` và không lưu refresh token thô.
4. Pending registration biến mất khỏi Redis.
5. Gọi lại endpoint bằng token cũ phải trả `400 INVALID_REGISTRATION_TOKEN`.
6. Gọi lại register bằng cùng email, kể cả đổi chữ hoa/thường, phải trả `409 EMAIL_TAKEN`.

## 3. Login và authorize Swagger

Mở `POST /auth/login`:

```json
{
  "email": "your-real-email@gmail.com",
  "password": "StartPass123!"
}
```

Login phải trả `200`, `expiresIn = 900` và một cặp token mới.

Để gọi endpoint cần đăng nhập:

1. Sao chép `accessToken`.
2. Bấm **Authorize** ở đầu Swagger UI.
3. Dán riêng chuỗi access token vào `bearerAuth`.
4. Bấm **Authorize**, sau đó đóng hộp thoại.
5. Mở `GET /auth/me` và bấm **Execute**; response phải trả đúng email vừa đăng ký.

## 4. Refresh và logout

Mở `POST /auth/refresh`, nhập refresh token nhận được từ login:

```json
{
  "refreshToken": "refresh-token-hiện-tại"
}
```

Kết quả cần kiểm tra:

1. API trả `200` với access token và refresh token mới.
2. Dùng lại refresh token cũ phải trả `401`.
3. Authorize Swagger bằng access token cũ rồi gọi `GET /auth/me`; API phải trả `401`.
4. Authorize lại bằng access token mới; `GET /auth/me` phải trả `200`.
5. Gọi `POST /auth/logout`; API trả `200`.
6. Gọi lại `GET /auth/me` hoặc refresh bằng token của phiên vừa logout; API phải trả `401`.

## 5. Đổi mật khẩu

Mục tiêu của `changePasswordController`: chỉ chủ tài khoản biết mật khẩu hiện tại mới đổi được mật khẩu, và khi đổi thành công thì mọi phiên cũ bị thu hồi.

1. Login lại bằng password hiện tại.
2. Authorize Swagger bằng access token vừa nhận.
3. Mở `POST /auth/change-password`:

```json
{
  "oldPassword": "StartPass123!",
  "newPassword": "ChangedPass123!"
}
```

4. Thử sai `oldPassword`: API phải báo lỗi và mật khẩu không đổi.
5. Thử lại đúng `oldPassword`: API phải trả `200`.
6. Access token và refresh token được cấp trước khi đổi mật khẩu phải trả `401`.
7. Login bằng password cũ phải trả `401`; login bằng `ChangedPass123!` phải trả `200`.

Muốn kiểm tra logout mọi thiết bị, tạo hai phiên login, authorize bằng một access token rồi gọi `POST /auth/logout-all`. API phải trả `200`; access token và refresh token của cả hai phiên đều phải trả `401`.

Login giới hạn 5 lần thất bại mỗi phút theo IP. Nếu nhận `429`, đợi hết cửa sổ một phút rồi test tiếp.

## 6. Quên và đặt lại mật khẩu qua Gmail

### 6.1. Yêu cầu đặt lại mật khẩu

Mục tiêu của `forgotPasswordController`: gửi link reset dùng một lần cho tài khoản tồn tại nhưng không để response tiết lộ email đã đăng ký hay chưa.

Mở `POST /auth/forgot-password`:

```json
{
  "email": "your-real-email@gmail.com"
}
```

Kết quả cần kiểm tra:

1. Email đã đăng ký: API trả `200`, Gmail nhận link reset.
2. RedisInsight có `reset:<hash>` với TTL tối đa 15 phút; Redis không lưu token thô.
3. Email chưa đăng ký: API vẫn trả `200`, không gửi email và không tạo reset token.

### 6.2. Đặt lại mật khẩu

Mục tiêu của `resetPasswordController`: token hợp lệ chỉ đổi mật khẩu được một lần và việc đổi mật khẩu thu hồi mọi phiên cũ.

Sao chép token trên URL Gmail rồi mở `POST /auth/reset-password`:

```json
{
  "token": "token-lấy-từ-link-gmail",
  "newPassword": "ResetPass123!"
}
```

Kết quả cần kiểm tra:

1. API trả `200` và thu hồi mọi phiên cũ.
2. Dùng lại reset token phải trả `400 INVALID_RESET_TOKEN`.
3. Login bằng password trước đó phải trả `401`.
4. Login bằng `ResetPass123!` phải trả `200`.
5. Access token và refresh token được cấp trước khi reset phải trả `401`.
6. Token để quá 15 phút phải trả `400 INVALID_RESET_TOKEN` và không đổi mật khẩu.

## Lưu ý phạm vi

Google/GitHub OAuth, `PATCH /auth/me` và upload avatar qua Cloudinary thuộc các bước sau. Đăng ký không gửi welcome email/BullMQ trong bước JWT này.
