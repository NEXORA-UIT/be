# AUTH Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo schema và migration PostgreSQL cho `User`, `RefreshToken`, `OAuthAccount` theo ERD để các bước JWT và OAuth dùng chung.

**Architecture:** Prisma schema và migration ở `prisma/`. `src/infrastructure/database/` chỉ tạo Prisma client khi bước endpoint cần truy vấn; bước này tập trung vào cấu trúc dữ liệu và phép kiểm tra ràng buộc. PostgreSQL local dùng Compose của bước 1.

**Tech Stack:** PostgreSQL 17, Prisma ORM 6.19 với `prisma-client-js`, TypeScript/Node.js 22+, pnpm.

**Spec:** `docs/AUTH/README.md`, `docs/AUTH/oauth-account-linking.md`, ERD `NEXORA ERD - CORE-Page-2.drawio.png` do bro cung cấp.

## Global Constraints

- Chỉ ba bảng AUTH; chưa có handler HTTP, Redis client hay API container.
- `passwordHash` nullable để hỗ trợ tài khoản chỉ dùng OAuth; không lưu mật khẩu hoặc token thô.
- Email `User` unique; khóa OAuth là `(provider, providerAccountId)`, thêm unique `(userId, provider)` theo ERD.
- UUID cho khóa chính và khóa ngoại; các thời điểm lưu `timestamptz`.
- `.env.local` chứa secret local và không đưa vào Git. Branch `feature/auth-data` hiện tạm dựa trên commit bước 1; bro tự push sau review.
- Giữ nguyên các chỉnh sửa `pnpm-lock.yaml` và `pnpm-workspace.yaml` đang có trước bước này; chỉ đưa vào commit phần thay đổi phục vụ Prisma.

## Review Focus

- Email khác chữ hoa/chữ thường: DB unique theo chuỗi; bước register/login sẽ chuẩn hóa email về lowercase trước ghi/tìm. Test ở bước endpoint.
- Hai OAuth callback đồng thời: hai unique constraint phải khiến chỉ một liên kết thắng. Test bằng insert trùng.
- Xóa user: quan hệ token và OAuth không được để lại bản ghi mồ côi. Test hành vi `onDelete` đã chọn.
- Chuỗi kết nối có ký tự đặc biệt trong password: hướng dẫn `DATABASE_URL` yêu cầu URL encoding; test `prisma migrate status` với cấu hình local thực.
- PostgreSQL chưa healthy hoặc cổng đã đổi: migration phải báo lỗi kết nối rõ ràng, không sửa Compose. Manual check sau `pnpm infra:up`.

---

### Task 1: Schema và migration ba bảng AUTH

**Files:**

- Modify: `package.json` (scripts `db:validate`, `db:migrate`, `db:generate` và dependency Prisma)
- Modify: `.env.local.example` (thêm cấu hình database local)
- Create: `prisma/schema.prisma`
- Create: `prisma.config.ts`
- Create: `prisma/migrations/<timestamp>_auth_core/migration.sql`
- Create: `tests/auth/schema.integration.test.ts`
- Prisma Client được generate vào `node_modules`; không thêm generated source vào Git.
- Modify: `docs/AUTH/README.md` hoặc `README.md` (lệnh manual check)

**Interfaces:**

- Consumes: cấu hình PostgreSQL từ `.env.local`.
- Produces: Prisma models `User`, `RefreshToken`, `OAuthAccount`; enums `UserStatus` (`ACTIVE`, `LOCKED`) và `OAuthProvider` (`GOOGLE`, `GITHUB`). `User.id` là UUID; `RefreshToken.userId` và `OAuthAccount.userId` tham chiếu `User.id`.

- [x] **Step 1: Thêm dependency và cấu hình kiểm tra.** Cài `prisma@6.19` (dev), `@prisma/client@6.19`, `dotenv`; thêm scripts trong `package.json` để nạp `.env.local`.
- [x] **Step 2: Viết test `tests/auth/schema.integration.test.ts`.** Dùng Node test runner qua `tsx --test`; test tạo User + token + OAuth account, từ chối trùng email/token hash/định danh provider, từ chối user gắn cùng provider lần hai, rồi xóa User và xác nhận hai bản ghi phụ biến mất.
- [ ] **Step 3: Chạy test để xác nhận fail vì chưa có models/bảng.** Nếu database/daemon không truy cập được, ghi trạng thái chưa kiểm chứng và tiếp tục các bước không cần DB.
- [x] **Step 4: Định nghĩa models theo ERD.** `User`: id, email, passwordHash?, fullName, avatarUrl?, status, createdAt, updatedAt. `RefreshToken`: id, userId, tokenHash, expiresAt, revokedAt?, createdAt. `OAuthAccount`: id, userId, provider, providerAccountId, providerEmail?, createdAt, updatedAt. Dùng UUID native và `timestamptz`; cascade khi xóa user để không còn bản ghi phụ mồ côi.
- [x] **Step 5: Tạo migration có tên `auth_core`, đọc SQL rồi áp dụng local.** Chạy `pnpm db:validate`, `pnpm db:migrate`, `pnpm db:generate`. Không dùng `db push` thay migration.
- [x] **Step 6: Chạy test tích hợp.** `pnpm test` phải pass với PostgreSQL local.
- [x] **Step 7: Viết hướng dẫn manual check.** `docs/AUTH/manual-jwt.md` ghi lệnh Docker, migration, generate và test; không in mật khẩu vào output.
- [ ] **Step 8: Kiểm tra cuối.** Chạy `pnpm typecheck`, `pnpm build`, `pnpm db:validate`, test tích hợp, `git diff --check`; commit chỉ file của bước 2 sau khi bro review code.

**Tài liệu Prisma:** [Prisma Client 6](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/generating-prisma-client), [compound unique constraints](https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints).
