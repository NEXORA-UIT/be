# Tài liệu API Nexora

Thư mục này chứa hợp đồng HTTP, bảng truy vết REST Core, quy ước dùng chung và hợp đồng realtime đang được hoãn.

## Nguồn OpenAPI

Đặc tả OpenAPI được chia theo [các phân hệ](openapi/README.md). Khi khởi động, backend ghép các mảnh thành một tài liệu hoàn chỉnh và cung cấp tại:

- `/api/docs` — giao diện Swagger UI
- `/api/docs/openapi.json` — tài liệu JSON
- `/api/docs/openapi.yaml` — tài liệu YAML

Hợp đồng HTTP vẫn là một tài liệu OpenAPI 3.0.3 thống nhất cho client và công cụ. Các `$ref` phải trỏ nội bộ tới `#/components/...`. Loader kiểm tra path/component trùng, `operationId` trùng và tham chiếu nội bộ chưa được khai báo trước khi server khởi động.

## Tài liệu liên quan

- [Quy ước API](conventions.md) mô tả hành vi HTTP, response envelope, phân trang và mã lỗi.
- [Bảng truy vết endpoint](endpoint-matrix.md) ánh xạ các luồng REST Core đã triển khai sang use case trong SRS. OpenAPI là nguồn chuẩn cho hợp đồng chi tiết.
- [Hợp đồng WebSocket](websocket.md) ghi nhận giao thức realtime dự kiến; phần triển khai Socket.IO đang được hoãn.
