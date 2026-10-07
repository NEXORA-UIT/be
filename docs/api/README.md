# Nexora API Documentation & Contract Foundation

## 1. Giới thiệu dự án

- **Tên dự án:** Nexora (Phát triển hệ thống quản lý dự án thông minh tích hợp AI Agent / *Development of an Intelligent Project Management System Integrated with AI Agents*).
- **Tính chất:** Hệ thống Quản lý Dự án Tổng quát (General Project Management Platform) dành cho đa lĩnh vực (Phần mềm, Giáo dục, Nghiên cứu, Marketing, Sự kiện, Vận hành nội bộ...).
- **Cấu trúc phân cấp thực thể cốt lõi:**

  ```text
  Workspace
    └── Board
          └── List
                └── Card
                      └── Task (Checklist)
  ```

- **Nguồn chân lý (Sources of Truth):**
  1. `Tài liệu SRS Đồ án 1.pdf`
  2. `ĐỀ CƯƠNG CHI TIẾT.pdf`
  3. `Sơ đồ Usecase.mdj`
  4. `Frontend/agent-docs/API_CONVENTIONS.md`

---

## 2. Cấu trúc thư mục tài liệu API

```text
docs/api/
├── README.md               # Tài liệu tổng quan kiến trúc và chỉ mục hợp đồng API (File này)
├── conventions.md          # Quy chuẩn giao thức HTTP, Headers, Envelopes, OCC, Catalog mã lỗi
├── endpoint-matrix.md      # Ma trận Endpoint Contract chi tiết (16 cột, ánh xạ 32 UC chuẩn SRS 3.1.3)
├── openapi.yaml            # Đặc tả OpenAPI 3.0 (Machine-readable Specification - Sẽ triển khai ở Phase 4)
└── websocket.md            # Đặc tả hợp đồng sự kiện thời gian thực (Sẽ triển khai ở Phase 6)
```

---

## 3. Ranh giới kiến trúc & Nguyên tắc cốt lõi

1. **Proposed Contract vs. SRS Requirements:**
   - Ma trận Endpoint Matrix đóng vai trò là **Hợp đồng API đề xuất (Proposed API Contract)** nhằm cụ thể hóa các yêu cầu nghiệp vụ thành các giao tiếp HTTP/RESTful.
   - Các trường thông tin (Fields), thực thể và quy tắc nghiệp vụ đều được đối chiếu trực tiếp với SRS. Mọi điểm suy luận kỹ thuật đều được ghi chú rõ ràng; các điểm chưa có đủ căn cứ trong tài liệu nguồn được gắn cờ `[NEEDS VERIFICATION]`.
2. **Độc lập cơ sở dữ liệu:**
   - Trách nhiệm thiết kế ERD/Database Schema thuộc về thành viên B (Nguyễn Gia Bảo).
   - Tầng API chỉ chuẩn hóa các Data Transfer Objects (DTO), tham số truy vấn và phản hồi, tuyệt đối không tự ý áp đặt cấu trúc bảng CSDL vật lý.
3. **Phân quyền và bảo mật nghiêm ngặt:**
   - **Workspace Owner:** Người khởi tạo Workspace, có toàn quyền quản trị Workspace và quyền chỉ định PM cho từng Board.
   - **Board PM:** Đúng 01 PM cho mỗi Board, kế thừa quyền Member và chịu trách nhiệm điều phối công việc, quản lý thành viên Board, và duyệt đề xuất của AI.
   - **Board Member:** Thành viên tham gia Board, chỉ thao tác trên Board được thêm vào.
   - **System Admin:** Quản trị vận hành hệ thống (Quota, Kill-Switch, Audit Log), không mặc định có quyền đọc dữ liệu nội dung dự án.
4. **Cơ chế Human-in-the-loop cho AI:**
   - Mọi hành vi do AI đề xuất làm thay đổi dữ liệu công việc (dời hạn chót, đổi người làm) bắt buộc phải tạo dưới dạng `AIProposal` (Action Card) có thời hạn hiệu lực (TTL 24h).
   - Hành động ghi dữ liệu vào hệ thống bắt buộc phải có thao tác phê duyệt của PM thông qua HTTP Header `Idempotency-Key: <uuid>`. AI không có quyền tự ý ghi đè dữ liệu.
5. **Tính tùy chọn của GitHub Connector:**
   - Hệ thống vận hành độc lập hoàn toàn với GitHub. Tích hợp GitHub chỉ là Proof-of-Concept (POC) minh họa theo từng Board.

---

## 4. Danh mục tài liệu tham chiếu

- Chi tiết quy ước API & Mã lỗi: Xem [conventions.md](conventions.md).
- Chi tiết bảng ma trận Endpoint: Xem [endpoint-matrix.md](endpoint-matrix.md).
