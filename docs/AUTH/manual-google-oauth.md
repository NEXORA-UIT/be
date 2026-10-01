# Manual Test Google OAuth bằng Swagger

Tài liệu này kiểm tra toàn bộ luồng Google OAuth khi frontend chưa được làm.

## 1. Mục tiêu

Sau khi test xong, bro cần thấy:

1. Backend tạo URL đăng nhập Google và login token dùng một lần.
2. Redis chỉ giữ hash của login token trong 10 phút.
3. Google trả `code` và `state` về callback URL.
4. Backend lấy đúng danh tính Google, tạo hoặc liên kết tài khoản Nexora.
5. Backend trả access token, refresh token và thông tin user.
6. Access token gọi được `/auth/me`.

## 2. Cấu hình Google Cloud

Trong Google Cloud Console:

1. Tạo hoặc chọn một project.
2. Cấu hình OAuth consent screen.
3. Nếu ứng dụng đang ở chế độ Testing, thêm Gmail của bro vào danh sách test users.
4. Tạo OAuth Client ID với loại **Web application**.
5. Thêm Authorized redirect URI chính xác:

```text
http://localhost:5173/oauth/callback/google
```

Scheme, port, path và dấu `/` cuối URL phải giống hoàn toàn.

## 3. Cấu hình backend

Thêm vào `.env`:

```dotenv
GOOGLE_CLIENT_ID=client-id-lay-tu-google-cloud
GOOGLE_CLIENT_SECRET=client-secret-lay-tu-google-cloud
OAUTH_ALLOWED_REDIRECT_URIS=http://localhost:5173/oauth/callback/google
OAUTH_STATE_TTL_SECONDS=600
```

Không đưa giá trị thật vào `.env.example` hoặc commit lên Git.

Khởi động infrastructure và backend:

```powershell
pnpm infra:up
pnpm dev
```

Mở Swagger:

```text
http://localhost:3000/api/docs
```

## 4. Bước 1 — Bắt đầu đăng nhập

Trong Swagger, gọi:

```http
POST /api/v1/auth/oauth/google/start
```

Body:

```json
{
  "redirectUri": "http://localhost:5173/oauth/callback/google"
}
```

Response thành công có dạng:

```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://accounts.google.com/...",
    "loginToken": "..."
  }
}
```

Tạm giữ `loginToken`. Frontend sau này sẽ lưu giá trị này trong `sessionStorage`.

### Kiểm tra RedisInsight

Tìm key:

```text
oauth-login:*
```

Kết quả đúng:

- Tên key chứa hash, không chứa login token thô.
- TTL còn tối đa 600 giây.
- Value có `provider`, `redirectUri` và `codeVerifier`.

## 5. Bước 2 — Đăng nhập Google khi chưa có frontend

1. Copy `authorizationUrl` từ response rồi mở trong trình duyệt.
2. Chọn tài khoản Google và đồng ý đăng nhập.
3. Google chuyển trình duyệt đến URL dạng:

```text
http://localhost:5173/oauth/callback/google?code=...&scope=...&state=...
```

Do chưa có frontend ở port `5173`, trình duyệt có thể báo không kết nối được. Đây là kết quả bình thường. `code` và `state` vẫn nằm trên thanh địa chỉ.

Copy toàn bộ callback URL trên thanh địa chỉ. Sau đó mở DevTools Console ở tab Swagger hoặc một trang bình thường và đọc hai giá trị đã được giải mã đúng:

```javascript
const callbackUrl = new URL('DAN_TOAN_BO_CALLBACK_URL_VAO_DAY');
callbackUrl.searchParams.get('code');
callbackUrl.searchParams.get('state');
```

So sánh `state` với `loginToken` nhận ở Bước 1. Hai giá trị phải giống nhau. Nếu khác nhau thì dừng, không gọi backend.

## 6. Bước 3 — Đổi code lấy JWT Nexora

Trong Swagger, gọi:

```http
POST /api/v1/auth/oauth/google
```

Body:

```json
{
  "code": "code-lay-tu-callback-url",
  "state": "state-lay-tu-callback-url",
  "redirectUri": "http://localhost:5173/oauth/callback/google"
}
```

Gọi ngay sau khi Google redirect vì authorization code có thời gian sống ngắn và chỉ dùng được một lần.

Response đúng chứa:

- `accessToken`
- `refreshToken`
- `expiresIn`
- `user`

Response không được chứa Google access token, Google refresh token, Google ID token hoặc client secret.

## 7. Bước 4 — Kiểm tra access token

1. Copy `accessToken` từ response.
2. Nhấn **Authorize** trong Swagger.
3. Nhập access token theo cách Swagger yêu cầu.
4. Gọi:

```http
GET /api/v1/auth/me
```

Kết quả đúng: API trả đúng user vừa đăng nhập bằng Google.

## 8. Kiểm tra Prisma Studio và RedisInsight

Mở Prisma Studio:

```powershell
pnpm prisma studio
```

Kiểm tra:

### Đăng nhập bằng Gmail chưa có trong Nexora

- Bảng `User` có một user mới.
- `passwordHash` là `null`.
- Bảng `OAuthAccount` có provider `GOOGLE` và `providerAccountId` là Google `sub`.
- Bảng `RefreshToken` có phiên đăng nhập Nexora mới.

### Gmail đã đăng ký bằng mật khẩu trước đó

- Không tạo thêm user.
- `passwordHash` cũ vẫn còn.
- Tạo thêm một `OAuthAccount` liên kết với user cũ.

### RedisInsight

Key `oauth-login:*` của lần đăng nhập vừa dùng phải biến mất sau khi endpoint hoàn tất đọc nó.

## 9. Test các trường hợp lỗi

| Cách test                                           | Kết quả mong đợi                 |
| --------------------------------------------------- | -------------------------------- |
| Dùng lại cùng `state`                               | `400 INVALID_OAUTH_STATE`        |
| Sửa `state`                                         | `400 INVALID_OAUTH_STATE`        |
| Đổi `redirectUri`                                   | `400 INVALID_OAUTH_STATE`        |
| Gửi redirect URI ngoài allowlist vào endpoint start | `400 INVALID_OAUTH_REDIRECT_URI` |
| Google email chưa xác minh                          | `401 OAUTH_EMAIL_NOT_VERIFIED`   |
| User Nexora bị khóa                                 | `403 ACCOUNT_LOCKED`             |
| Thiếu Google client ID hoặc secret                  | `503 OAUTH_NOT_CONFIGURED`       |

Nếu code đã hết hạn hoặc đã dùng, hãy bắt đầu lại từ Bước 1.
