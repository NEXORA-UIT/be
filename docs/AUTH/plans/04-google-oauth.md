# Google OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép người dùng đăng nhập Nexora bằng Google Authorization Code flow, có login token dùng một lần, PKCE, liên kết email đã xác minh và cấp JWT Nexora.

**Architecture:** Frontend xin authorization URL từ backend, giữ login token trong `sessionStorage`, rồi mở trang Google. Sau callback, frontend gửi `code` và `state` về backend; backend lấy redirect URI cố định từ config môi trường, kiểm tra Redis, đổi code bằng thư viện chính thức của Google, tìm hoặc tạo `OAuthAccount`, rồi dùng `issueTokens()` hiện có.

**Tech Stack:** Express 5, TypeScript, Zod, Prisma/PostgreSQL, Redis, `google-auth-library`, Node test runner, Swagger/OpenAPI.

**Spec:** `docs/AUTH/oauth-login-design.md`

## Global Constraints

- Làm Google trước; GitHub nằm ở plan riêng sau khi Google đã merge.
- Callback local mặc định: `http://localhost:5173/oauth/callback/google`.
- OAuth query vẫn dùng tên chuẩn `state` và `code`; biến nội bộ dùng `loginToken` và `authorizationCode`.
- Login token có TTL 600 giây, lưu hash trong Redis và chỉ dùng một lần.
- Frontend giữ login token thô trong `sessionStorage` và tự so sánh với callback `state` trước khi gọi backend.
- Redirect URI cố định theo môi trường qua `GOOGLE_REDIRECT_URI`; frontend không gửi giá trị này.
- Google identity dùng `sub`; email chỉ dùng lần đầu và phải có `email_verified = true`.
- Không lưu Google access token, refresh token hoặc ID token.
- Chỉ xin quyền `openid email profile`; không yêu cầu offline access nên Google không cấp refresh token cho Nexora.
- Không log client secret, login token, authorization code hoặc bất kỳ token nào.
- Thiếu Google credentials không được làm hỏng các API JWT hiện có; endpoint Google trả lỗi tập trung `OAUTH_NOT_CONFIGURED`.
- Controller không gọi trực tiếp Redis, Prisma hoặc Google.
- Mỗi task dừng để review và manual check trước khi sang task kế tiếp.

## Review Focus

- Callback có `state` hợp lệ trong Redis nhưng không khớp `sessionStorage`: frontend phải dừng trước khi gọi backend; manual guide phải chỉ rõ bước này.
- Hai request dùng cùng login token: chỉ request đầu được đổi code; request sau trả `INVALID_OAUTH_STATE`.
- Authorization URL và bước đổi code luôn dùng cùng `GOOGLE_REDIRECT_URI`.
- Google trả ID token đúng chữ ký nhưng sai audience hoặc hết hạn: không tạo/liên kết user và không cấp JWT.
- Hai lần đăng nhập Google đầu tiên chạy đồng thời với cùng email/sub: unique constraint và transaction không được tạo user hoặc liên kết trùng.

---

### Task 1: Google OAuth foundation và login token

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.local.example`
- Modify: `.env.production.example`
- Create: `src/config/oauth.config.ts`
- Modify: `src/modules/auth/utils/auth.constants.ts`
- Modify: `src/modules/auth/utils/auth.errors.ts`
- Create: `src/modules/auth/repository/oauth-state.repository.ts`
- Create: `src/infrastructure/oauth/google.client.ts`
- Create: `src/modules/auth/services/google-oauth-state.service.ts`
- Test: `tests/auth/google-oauth-state.integration.test.ts`

**Interfaces:**

- Produces: `startGoogleLogin(): Promise<{ authorizationUrl: string; loginToken: string }>`.
- Produces: `consumeGoogleLogin(loginToken: string): Promise<{ codeVerifier: string }>`.
- Produces: `googleOAuthClient.exchangeCode(input: { authorizationCode: string; redirectUri: string; codeVerifier: string }): Promise<GoogleProfile>` for Task 2.
- `GoogleProfile` chỉ gồm `{ providerAccountId, email, emailVerified, fullName, avatarUrl }`.

- [ ] **Step 1: Add the failing state lifecycle tests.** Assert that start returns an authorization URL containing `state` and the configured redirect URI, stores only the token hash with TTL 600, records Google/PKCE verifier, consumes once and rejects reuse.
- [ ] **Step 2: Run `node .\node_modules\tsx\dist\cli.mjs --test tests\auth\google-oauth-state.integration.test.ts`.** Expected: FAIL because the OAuth state service does not exist.
- [ ] **Step 3: Install `google-auth-library` and add config.** Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `OAUTH_STATE_TTL_SECONDS=600` to the environment examples; keep real secrets out of Git and let the JWT server start before these optional values are configured.
- [ ] **Step 4: Implement the Redis repository and state service.** Hash the login token, use one Redis key, save JSON with TTL and consume using `GETDEL`; verify the provider after parsing.
- [ ] **Step 5: Implement the Google client wrapper.** Use `OAuth2Client.generateCodeVerifierAsync()`, `generateAuthUrl()`, `getToken()` and `verifyIdToken()`; request only `openid email profile` and return a small `GoogleProfile` instead of raw provider tokens.
- [ ] **Step 6: Run the focused test and `pnpm build`.** Expected: PASS.
- [ ] **Step 7: Commit the task.** Commit message: `feat(auth): add Google OAuth login state`.
- [ ] **Step 8: Stop for code review and RedisInsight manual check.** Confirm one hashed `oauth-login:*` key appears with TTL and disappears after consume.

---

### Task 2: Resolve Google identity into a Nexora account

**Files:**

- Create: `src/modules/auth/repository/oauth-account.repository.ts`
- Create: `src/modules/auth/services/google-oauth.service.ts`
- Test: `tests/auth/google-oauth.integration.test.ts`

**Interfaces:**

- Consumes: `consumeGoogleLogin()` and `googleOAuthClient.exchangeCode()` from Task 1.
- Produces: `loginWithGoogle(input: { code: string; state: string }, client?): Promise<AuthTokens>`.

- [ ] **Step 1: Add failing identity tests with a fake Google client and real PostgreSQL/Redis.** Cover existing provider ID, new verified email, automatic link to an existing password user, unverified email, locked user, reused state, wrong audience/provider error and concurrent duplicate creation.
- [ ] **Step 2: Run `node .\node_modules\tsx\dist\cli.mjs --test tests\auth\google-oauth.integration.test.ts`.** Expected: FAIL because account resolution is missing.
- [ ] **Step 3: Implement repository operations.** Find by `(GOOGLE, providerAccountId)`; create `User + OAuthAccount` or link an existing user inside a Prisma transaction; translate only known unique conflicts into centralized OAuth errors.
- [ ] **Step 4: Implement `loginWithGoogle()`.** Consume login state, exchange code, require verified email, resolve/link account according to the spec, reject locked users, then call existing `issueTokens(userId)`.
- [ ] **Step 5: Run the focused test, `pnpm test` and `pnpm build`.** Expected: all PASS.
- [ ] **Step 6: Commit the task.** Commit message: `feat(auth): authenticate users with Google`.
- [ ] **Step 7: Stop for code review and Prisma Studio check.** Confirm OAuth-created users have `passwordHash = null`, while automatic linking keeps the old password hash and adds one `OAuthAccount`.

---

### Task 3: HTTP endpoints, Swagger và manual guide

**Files:**

- Create: `src/modules/auth/dto/google-oauth.schema.ts`
- Create: `src/modules/auth/controllers/google-oauth.controller.ts`
- Create: `src/modules/auth/routes/google-oauth.routes.ts`
- Modify: `src/modules/auth/routes/index.ts`
- Modify: `docs/api/openapi/`
- Modify: `docs/api/endpoint-matrix.md`
- Create: `docs/AUTH/manual-google-oauth.md`
- Test: `tests/auth/google-oauth-http.integration.test.ts`

**Interfaces:**

- `POST /api/v1/auth/oauth/google/start` consumes `{}` and returns `{ authorizationUrl, loginToken }`.
- `POST /api/v1/auth/oauth/google/callback` consumes `{ code, state }` and returns the existing auth token response.

- [ ] **Step 1: Add failing HTTP tests.** Assert success statuses and response shapes, strict body validation, centralized OAuth errors, no provider token leakage and no secret values in responses.
- [ ] **Step 2: Run `node .\node_modules\tsx\dist\cli.mjs --test tests\auth\google-oauth-http.integration.test.ts`.** Expected: FAIL because the routes do not exist.
- [ ] **Step 3: Add DTO, controller and routes.** Keep controller limited to reading validated input, calling the service and returning the standard success response.
- [ ] **Step 4: Update OpenAPI and endpoint matrix.** Document both Google endpoints, required `code/state`, environment-owned redirect URI, error codes and the frontend `sessionStorage` responsibility.
- [ ] **Step 5: Write the Swagger manual guide.** Include Google Console setup, test user, exact local redirect URI, how to copy `code/state` when frontend is absent, RedisInsight checks and Prisma Studio checks.
- [ ] **Step 6: Run focused HTTP tests, `pnpm test`, `pnpm build`, `pnpm format:check` and `git diff --check`.** Expected: all PASS.
- [ ] **Step 7: Commit the task.** Commit message: `docs(auth): document Google OAuth API and testing`.
- [ ] **Step 8: Stop for full manual review.** Bro tests start → Google consent → exchange → `/auth/me` before planning GitHub.
