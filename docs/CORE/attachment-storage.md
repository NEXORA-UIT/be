# Cấu hình và di chuyển Card Attachment sang R2

Card Attachment dùng `ObjectStorage`; Knowledge Base Document là luồng riêng. Local và test mặc định dùng filesystem. Production bắt buộc đặt `ATTACHMENT_STORAGE_PROVIDER=r2` cùng đủ cấu hình bucket và credentials; ứng dụng dừng ngay khi cấu hình thiếu. Không ghi credentials vào Git, log hoặc frontend.

Các biến production:

| Biến                          | Ý nghĩa                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `ATTACHMENT_STORAGE_PROVIDER` | Phải là `r2` trong production.                             |
| `R2_ENDPOINT`                 | Endpoint S3 API của tài khoản Cloudflare R2.               |
| `R2_BUCKET`                   | Bucket giữ Card Attachment.                                |
| `R2_ACCESS_KEY_ID`            | Access key chỉ có quyền cần thiết trên bucket.             |
| `R2_SECRET_ACCESS_KEY`        | Secret tương ứng, quản lý qua secret store của môi trường. |

Adapter dùng region `auto`, giữ nguyên storage key UUID của Attachment và coi lệnh xóa lặp là an toàn. Khi upload ghi object thành công nhưng ghi DB thất bại, `PendingObjectCleanup` tiếp tục giữ key để có thể retry. Xóa Board chỉ xóa relational rows sau khi đã dọn hết object; nếu storage lỗi hoặc transaction DB rollback, có thể chạy lại thao tác vì xóa object là idempotent.

## Chuyển dữ liệu filesystem hiện có

Chưa có bằng chứng trong repository để khẳng định production đang có hoặc không có blob filesystem. Trước khi đổi provider, người triển khai phải đối chiếu các hàng `Attachment` có `storageKey` với thư mục filesystem thực tế của production. Không được bật R2 nếu còn attachment cũ mà object tương ứng chưa đọc được từ bucket.

Nếu production chưa có attachment filesystem, ghi nhận kết quả kiểm kê và bật R2 với cấu hình đã kiểm tra. Nếu có dữ liệu, lập cửa sổ bảo trì để ngừng upload/xóa attachment, sao chép từng object sang bucket với **cùng storage key**, đối chiếu số lượng và checksum, thử tải các object đại diện, rồi mới đổi provider và khởi động lại dịch vụ. Giữ bản filesystem gốc cho đến khi xác minh được tải xuống qua R2 và có bản sao lưu. Nếu thiếu object, lệch checksum hoặc không thể đọc, giữ provider cũ và khắc phục trước khi chuyển.

Adapter hiện chọn một provider cho toàn bộ attachment; không có dual-read tự động. Do đó, việc chuyển chỉ an toàn khi tất cả key còn được tham chiếu trong DB đã tồn tại và được xác minh ở provider đích.
