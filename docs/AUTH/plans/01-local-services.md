# AUTH Local Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy PostgreSQL và Redis cho AUTH bằng Docker Compose, có health check và hướng dẫn kiểm tra local.

**Architecture:** Compose ở `infrastructure/docker/` chỉ quản lý hai dịch vụ dữ liệu trong bước này. Backend tiếp tục chạy trên host; container API thuộc bước kế tiếp. Cổng chỉ bind vào loopback, dữ liệu nằm trong named volumes.

**Tech Stack:** Docker Compose, `postgres:17-alpine`, `redis:7-alpine`.

**Spec:** `docs/AUTH/README.md`

## Global Constraints

- Không code endpoint AUTH, Prisma hoặc container API trong bước này.
- Commit sau khi bro review bước 1; bro tự push.
- `infrastructure/docker/` là hạ tầng Docker ở gốc repo; `src/infrastructure/` dành cho adapter runtime.
- Không ghi secret thật vào Git. `.env.example` chỉ chứa giá trị minh họa cho local.
- Host ports PostgreSQL/Redis chỉ bind `127.0.0.1`.

## Review Focus

- Docker daemon chưa chạy: `docker compose config` vẫn xác minh cú pháp; lệnh `up` phải được báo là chưa kiểm chứng, không coi là pass.
- Port 5432 hoặc 6379 đang bị chiếm: có thể đổi `POSTGRES_PORT`/`REDIS_PORT` trong `.env` mà không sửa Compose.
- `POSTGRES_PASSWORD` thiếu: Compose phải báo lỗi cấu hình thay vì chạy với mật khẩu rỗng.
- Container khởi động chậm: health check phải phản ánh readiness của PostgreSQL/Redis.
- `down` rồi `up` lại: named volumes giữ dữ liệu; `down --volumes` chỉ dùng khi bro muốn xóa dữ liệu local.

---

### Task 1: Compose PostgreSQL và Redis

**Files:**
- Create: `infrastructure/docker/compose.yaml`
- Create: `.env.example`
- Modify: `README.md` (thêm hướng dẫn chạy Docker local và lệnh manual check)

**Interfaces:**
- Consumes: `.env` ở gốc repo với `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT`.
- Produces: PostgreSQL tại `localhost:${POSTGRES_PORT}` và Redis tại `localhost:${REDIS_PORT}` cho backend chạy trên host.

- [x] **Step 1: Kiểm tra Compose chưa tồn tại**

  Run: `docker compose -f infrastructure/docker/compose.yaml --env-file .env.example config`

  Expected: FAIL vì chưa có Compose file.

- [x] **Step 2: Tạo `.env.example`**

  Giá trị local: `POSTGRES_DB=nexora`, `POSTGRES_USER=nexora`, `POSTGRES_PASSWORD=replace-with-local-secret`, `POSTGRES_PORT=5432`, `REDIS_PORT=6379`.

- [x] **Step 3: Tạo `infrastructure/docker/compose.yaml`**

  `postgres:17-alpine` dùng volume `postgres_data` tại `/var/lib/postgresql/data`, health check `pg_isready` với database/user từ môi trường. `redis:7-alpine` bật AOF, dùng volume `redis_data` tại `/data`, health check `redis-cli ping`. Publish hai cổng chỉ ở `127.0.0.1`; dùng `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}` để từ chối mật khẩu rỗng.

- [x] **Step 4: Kiểm tra Compose**

  Run: `docker compose --env-file .env.example -f infrastructure/docker/compose.yaml config --quiet`

  Expected: exit 0, không báo lỗi cấu hình.

  Run thêm với `POSTGRES_PORT=15432` và `REDIS_PORT=16379` trong môi trường của lệnh; xem `docker compose ... config` để xác nhận cổng publish đổi theo mà không sửa YAML.

- [x] **Step 5: Kiểm tra thiếu password bị từ chối**

  Run trong một PowerShell process: `$env:POSTGRES_PASSWORD = ''; docker compose --env-file .env.example -f infrastructure/docker/compose.yaml config --quiet`

  Expected: exit khác 0 và thông báo `POSTGRES_PASSWORD is required`.

- [x] **Step 6: Viết hướng dẫn trong `README.md`**

  Hướng dẫn copy `.env.example` thành `.env`, thay password local, chạy `docker compose --env-file .env -f infrastructure/docker/compose.yaml up -d`, xem `ps`, kiểm tra PostgreSQL bằng `pg_isready` trong container và Redis bằng `redis-cli ping`, rồi `down`. Nêu rõ `down` giữ volumes.

- [ ] **Step 7: Manual check khi Docker daemon chạy** — chờ bro bật Docker và kiểm tra trên máy.

  Run: `docker compose --env-file .env -f infrastructure/docker/compose.yaml up -d`

  Run: `docker compose --env-file .env -f infrastructure/docker/compose.yaml ps`

  Expected: cả hai service `healthy`; backend hiện chưa kết nối database/Redis. Sau đó chạy các lệnh `pg_isready` và `redis-cli ping` được ghi trong README.

  Run `docker compose --env-file .env -f infrastructure/docker/compose.yaml down` rồi `up -d` lại; xác nhận hai named volumes vẫn tồn tại. Không chạy `down --volumes` khi còn cần dữ liệu local.

- [x] **Step 8: Kiểm tra diff trước khi bro review**

  Run: `git diff --check`

  Expected: exit 0; chỉ có các file của bước 1 và thay đổi tài liệu AUTH đang chờ review.
