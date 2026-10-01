# Email Verification Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đổi đăng ký email/mật khẩu thành flow hai bước: gửi link xác nhận trước, chỉ tạo `User` và cấp JWT sau khi frontend gửi token xác nhận về backend.

**Architecture:** `POST /auth/register` hash password, lưu pending registration trong Redis 15 phút và gửi link Gmail. `POST /auth/verify-registration` đọc pending registration theo token hash, tạo `User`, xóa pending data rồi dùng `issueTokens()` hiện có. PostgreSQL không thêm trạng thái `PENDING` và không cần migration.

**Tech Stack:** Express 5, TypeScript, Zod, bcrypt, Redis, Prisma/PostgreSQL, Nodemailer Gmail, Node test runner.

**Spec:** `docs/AUTH/email-verification-registration.md`

## Global Constraints

- Không tạo `User`, access token hoặc refresh token tại `POST /auth/register`.
- Redis chỉ lưu email chuẩn hóa, full name và bcrypt password hash; không lưu password hoặc registration token thô.
- Registration token dùng SHA-256 làm key và hết hạn sau 15 phút.
- Link Gmail dùng `AUTH_VERIFY_URL` và query parameter `token`.
- Frontend gọi `POST /auth/verify-registration`; khi chưa có frontend, manual test lấy token từ URL Gmail.
- Không thêm model hoặc migration Prisma.
- Giữ controller, route, repository và service tách riêng theo structure hiện tại.
- Không tự commit hoặc push; kết thúc mỗi task để bro review và test.

## Review Focus

- Email đã tồn tại phải trả `409 EMAIL_TAKEN` trước khi gửi mail và khi xác nhận.
- Token sai, hết hạn hoặc đã dùng phải trả `400 INVALID_REGISTRATION_TOKEN` và không tạo `User`.
- Gmail gửi lỗi phải xóa pending registration vừa tạo để Redis không giữ dữ liệu không sử dụng.
- Hai request xác nhận đồng thời chỉ được tạo một `User`; unique constraint email bảo vệ request còn lại.
- Password thô và raw registration token không được xuất hiện trong PostgreSQL hoặc Redis.

---

### Task 1: Cấu hình và Redis pending registration

**Files:**

- Modify: `.env.example`
- Modify: `src/config/auth.config.ts`
- Modify: `src/config/email/email.config.ts`
- Modify: `src/modules/auth/utils/auth.constants.ts`
- Modify: `src/modules/auth/repository/auth-cache.repository.ts`
- Test: `tests/auth/registration-cache.integration.test.ts`

**Interfaces:**

- Produces: `authConfig.registrationTtlSeconds = 15 * 60`.
- Produces: `emailConfig.verifyUrl` đọc từ `AUTH_VERIFY_URL`.
- Produces: `AUTH_CACHE_KEY.pendingRegistration(tokenHash: string): string`.
- Produces: `PendingRegistration = { email: string; passwordHash: string; fullName: string }`.
- Produces: `savePendingRegistration(tokenHash, data, ttlSeconds)`, `findPendingRegistration(tokenHash)` và `removePendingRegistration(tokenHash)` trong `authCacheRepository`.

- [x] **Step 1: Viết test Redis fail trước.** Test lưu pending registration, đọc đúng ba field, kiểm tra TTL trong khoảng `1..900`, xóa key, rồi xác nhận không đọc lại được.
- [x] **Step 2: Chạy `pnpm test` và xác nhận fail vì các method/key chưa tồn tại.**
- [x] **Step 3: Thêm `AUTH_VERIFY_URL`, TTL, Redis key và ba repository method.** Serialize/parse JSON trong repository; service không gọi `redis` trực tiếp.
- [x] **Step 4: Chạy `pnpm test` và `pnpm build`; cả hai phải pass.**
- [ ] **Step 5: Manual check bằng RedisInsight.** Lưu một pending registration qua test và xác nhận key có TTL, value chỉ có email, full name và bcrypt hash.
- [x] **Step 6: Dừng để bro review Task 1.**

### Task 2: Service gửi link và xác nhận đăng ký

**Files:**

- Create: `src/modules/auth/services/registration.service.ts`
- Modify: `src/modules/auth/services/auth.service.ts`
- Modify: `src/modules/auth/utils/auth.errors.ts`
- Modify: `src/infrastructure/email/email.client.ts`
- Test: `tests/auth/registration.integration.test.ts`

**Interfaces:**

- Consumes: pending registration repository từ Task 1; `randomToken()`, `hashToken()`, `sendEmail()`, `userRepository.create()` và `issueTokens()` hiện có.
- Produces: export type `EmailMessage` từ email client để fake sender dùng đúng contract.
- Produces: `requestRegistration(input: RegisterDto, deliver: typeof sendEmail = sendEmail): Promise<void>`; controller dùng default nên gửi Gmail thật, test truyền fake sender.
- Produces: `verifyRegistration(token: string): Promise<AuthTokens>`; `AuthTokens` dùng return type hiện có của `issueTokens()`.
- Produces: `authErrors.invalidRegistration()` với HTTP `400`, code `INVALID_REGISTRATION_TOKEN`.

- [x] **Step 1: Viết test fail cho `requestRegistration`.** Truyền sender giả để lấy `EmailMessage` mà không gửi Gmail; xác nhận email được lowercase, password được bcrypt hash, pending data có TTL 900, nội dung email chứa `AUTH_VERIFY_URL?token=...`, không tạo `User` và không trả JWT.
- [x] **Step 2: Viết test fail cho lỗi gửi Gmail.** Email adapter giả ném lỗi; pending registration phải bị xóa.
- [x] **Step 3: Viết test fail cho `verifyRegistration`.** Token hợp lệ tạo `User`, xóa pending key, trả user/access/refresh token; token dùng lại và token không tồn tại trả `INVALID_REGISTRATION_TOKEN`.
- [x] **Step 4: Viết test fail cho email race.** Tạo `User` cùng email trước khi verify; service phải trả `EMAIL_TAKEN`, không tạo bản ghi thứ hai.
- [x] **Step 5: Chạy riêng test registration integration và xác nhận fail vì service chưa tồn tại.**
- [x] **Step 6: Tạo `registration.service.ts`.** Service chịu trách nhiệm orchestration; `auth.service.ts` chỉ giữ login và change password sau khi bỏ hàm `register()` cũ.
- [x] **Step 7: Chạy test registration, sau đó `pnpm test` và `pnpm build`; tất cả phải pass.**
- [x] **Step 8: Dừng để bro review Task 2.**

### Task 3: HTTP endpoints và integration test

**Files:**

- Modify: `src/modules/auth/dto/auth.schema.ts`
- Modify: `src/modules/auth/controllers/auth.controller.ts`
- Modify: `src/modules/auth/routes/index.ts`
- Modify: `src/modules/auth/utils/auth.constants.ts`
- Modify: `tests/auth/jwt.integration.test.ts`

**Interfaces:**

- Produces: `verifyRegistrationSchema = z.strictObject({ token: z.string().min(1) })` và `VerifyRegistrationDto`.
- Produces: `AUTH_ROUTE.verifyRegistration = '/verify-registration'`.
- Changes: `registerController` gọi `requestRegistration()` và trả `202` với message `Kiểm tra email để hoàn tất đăng ký`.
- Produces: `verifyRegistrationController` gọi `verifyRegistration()` và trả `201` với auth tokens.

- [x] **Step 1: Sửa integration test để mô tả contract mới.** Register invalid trả `400`; verify token đã seed vào Redis trả `201`; verify lần hai trả `400`; login sau verify trả `200`. Việc register thành công nhưng chưa tạo `User` đã được test bằng fake sender ở Task 2.
- [x] **Step 2: Chạy `pnpm test` và xác nhận test fail vì contract register hiện vẫn trả `201` và chưa có endpoint verify.**
- [x] **Step 3: Thêm DTO, controller, route và route constant.** Không gọi Redis hoặc Prisma trực tiếp từ controller.
- [x] **Step 4: Chạy `pnpm test`, `pnpm build` và `pnpm format:check`; tất cả phải pass.**
- [ ] **Step 5: Manual check không dùng Gmail.** Seed pending registration bằng test helper, gọi verify endpoint, kiểm tra Prisma Studio có `User` và `RefreshToken`, RedisInsight mất pending key.
- [x] **Step 6: Dừng để bro review Task 3.**

### Task 4: API docs và manual Gmail test

**Files:**

- Modify: `docs/api/openapi.yaml`
- Modify: `docs/api/endpoint-matrix.md`
- Modify: `docs/AUTH/manual-jwt.md`
- Verify: `docs/AUTH/email-verification-registration.md`

**Interfaces:**

- Documents: `POST /auth/register` trả `202` và không trả token.
- Documents: `POST /auth/verify-registration` nhận `{ token }`, trả `201 AuthTokensResponse`.
- Documents: `AUTH_VERIFY_URL=http://localhost:5173/verify-email` cho local development.

- [x] **Step 1: Cập nhật OpenAPI và endpoint matrix.** Bỏ mô tả welcome email/BullMQ khỏi register; thêm verify endpoint, response và error codes.
- [x] **Step 2: Cập nhật manual JWT.** Thay bước register cũ bằng register → Gmail → lấy token từ URL → verify; thêm Prisma Studio và RedisInsight assertions.
- [x] **Step 3: Chạy `pnpm format:check`, `pnpm build`, `pnpm test` và `git diff --check`; tất cả phải pass.**
- [ ] **Step 4: Manual test Gmail end-to-end.** Register trả `202`; PostgreSQL chưa có user; Gmail nhận đúng link; verify trả `201`; PostgreSQL có user; pending key biến mất; token cũ trả `400`.
- [ ] **Step 5: Dừng để bro review toàn bộ flow và tự chọn các nhóm file để commit.**
