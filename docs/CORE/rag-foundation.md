# RAG: ranh giới giữa BE và AI service

Hợp đồng job, HTTP nội bộ, SSE và thứ tự bàn giao nằm ở [ai/docs/rag-contract.md](../../../ai/docs/rag-contract.md). Đây là tài liệu chung để Đạt và Bảo triển khai song song. Public FE ↔ BE vẫn theo OpenAPI trong `docs/api/openapi/knowledge-base.yaml`.

## Phần BE sở hữu

- Express xác thực và kiểm tra quyền board, upload file lên R2, tạo `Document(PENDING)` và gửi `document.ingest.v1` vào BullMQ. BE quản lý Prisma schema/migration.
- Python Worker sẽ là consumer duy nhất của queue RAG và ghi chunks/trạng thái với revision guard. Node workers hiện có chỉ xử lý email và maintenance.
- Express gọi FastAPI cho query nội bộ và proxy SSE về FE; FastAPI lọc dữ liệu theo board và tài liệu `READY`.
- `Document`/`DocumentChunk`, producer và FastAPI query chưa triển khai. Các schema JSON snapshot và ping job Phase 0 đã được gỡ; không dựa vào chúng khi code flow thật.

## PostgreSQL / pgvector

BE đã có image PostgreSQL chứa pgvector và migration bật extension `vector`. Prisma tiếp tục sở hữu migration, Python dùng psycopg 3 khi có ingestion/retrieval. Nếu container đang dùng image PostgreSQL cũ, rebuild riêng service PostgreSQL:

```powershell
docker compose --env-file .env.local -f infrastructure/docker/compose.yaml up -d --build postgres
```

SRS vẫn yêu cầu BullMQ cho xử lý dài, Tika có giới hạn tài nguyên, revision guard khi re-upload và worker scale độc lập. Chốt cột/index cùng Đạt trước khi viết SQL Python.
