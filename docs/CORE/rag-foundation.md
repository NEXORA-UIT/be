# RAG: ranh giới giữa BE và AI service

[Kiến trúc RAG](../../../ai/docs/rag-architecture.md) là tài liệu chung để nhóm BE, Đạt và Bảo triển khai theo cùng trách nhiệm. Nó chưa phải hợp đồng job hay API.

- Express sở hữu public API, xác thực, phân quyền theo Board, upload R2, metadata tài liệu và Prisma migration. Express giao ingestion qua Redis + BullMQ và kết nối FastAPI cho truy vấn RAG.
- Python BullMQ Worker xử lý ingestion độc lập; không cần Node.js RAG Worker trung gian. Node.js workers hiện có cho email và maintenance không đổi.
- FastAPI sở hữu retrieval theo phạm vi Board và sinh câu trả lời có nguồn tham chiếu. Express tiếp tục chịu trách nhiệm phân quyền nghiệp vụ.
- PostgreSQL + pgvector là cơ sở dữ liệu chung. BE đã có image pgvector và migration bật extension; Python dùng psycopg 3 khi triển khai ingestion/retrieval.

Hiện chỉ có nền tảng Phase 0 của repo AI; các bảng dữ liệu RAG, producer và luồng truy vấn chưa được triển khai. Tên job, payload, schema, route, giao thức phản hồi và cơ chế chống kết quả cũ sẽ được chốt khi làm từng phase.

Phần RAG trong [BE OpenAPI](../api/openapi/knowledge-base.yaml) hiện là **bản dự thảo** và còn mô tả chi tiết chưa được chốt. Cần rà lại đặc tả này cùng FE khi bắt đầu triển khai public API; không suy ra rằng BE đã có route RAG chạy thật.
