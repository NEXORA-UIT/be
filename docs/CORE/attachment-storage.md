# Lưu trữ Card Attachment

Card Attachment dùng `ObjectStorage`; Knowledge Base Document là luồng riêng. Local và test mặc định dùng filesystem. Production bắt buộc đặt `ATTACHMENT_STORAGE_PROVIDER=r2` cùng đủ cấu hình bucket và credentials; ứng dụng dừng ngay khi cấu hình thiếu. Không ghi credentials vào Git, log hoặc frontend.

Các biến production:

| Biến                          | Ý nghĩa                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `ATTACHMENT_STORAGE_PROVIDER` | Phải là `r2` trong production.                             |
| `R2_ENDPOINT`                 | Endpoint S3 API của tài khoản Cloudflare R2.               |
| `R2_BUCKET`                   | Bucket giữ Card Attachment.                                |
| `R2_ACCESS_KEY_ID`            | Access key chỉ có quyền cần thiết trên bucket.             |
| `R2_SECRET_ACCESS_KEY`        | Secret tương ứng, quản lý qua secret store của môi trường. |

Adapter dùng region `auto`, giữ nguyên storage key UUID của Attachment và coi lệnh xóa lặp là an toàn. Nếu upload object thành công nhưng ghi metadata DB thất bại, key được ghi vào `PendingObjectCleanup` để scheduler thử dọn lại.

## Luồng xóa và retry

Xóa Attachment kiểm tra quyền và định dạng `storageKey` trong transaction, ghi key vào `PendingObjectCleanup`, xóa metadata và ghi activity log. Xóa vĩnh viễn Board kiểm tra đủ key hợp lệ rồi ghi tất cả vào cùng transaction với thao tác xóa Board. Key thiếu hoặc sai định dạng khiến thao tác bị từ chối và dữ liệu được giữ lại để kiểm tra. Nếu transaction rollback thì cả metadata lẫn yêu cầu cleanup đều rollback; API không chờ storage.

Scheduler mới xóa object sau khi transaction đã commit. Trước khi xóa, nó kiểm tra không còn Attachment tham chiếu key; nếu có thì hoãn mục 10 phút. Chỉ xóa hàng cleanup sau khi provider xác nhận thành công; xóa key không tồn tại được xem là thành công. Lỗi storage tăng `attemptCount` và lên lịch lại theo exponential backoff, tối đa 24 giờ. Mục lỗi không bị bỏ đi, không chặn các mục khác và có thể xem bằng truy vấn vận hành vào `PendingObjectCleanup`.

Cách chạy và lịch định kỳ nằm trong [scheduled-jobs.md](scheduled-jobs.md). Không xóa trực tiếp object trong transaction PostgreSQL.

## Chuyển dữ liệu filesystem hiện có

Trước khi đổi provider, đối chiếu các hàng `Attachment` có `storageKey` với thư mục filesystem thực tế của production. Không bật R2 nếu còn attachment cũ mà object tương ứng chưa đọc được từ bucket.

Nếu production chưa có attachment filesystem, ghi nhận kết quả kiểm kê và bật R2 với cấu hình đã kiểm tra. Nếu có dữ liệu, lập cửa sổ bảo trì để ngừng upload/xóa attachment, sao chép từng object sang bucket với **cùng storage key**, đối chiếu số lượng và checksum, thử tải các object đại diện, rồi mới đổi provider và khởi động lại dịch vụ. Giữ bản filesystem gốc cho đến khi xác minh được tải xuống qua R2 và có bản sao lưu. Nếu thiếu object, lệch checksum hoặc không thể đọc, giữ provider cũ và khắc phục trước khi chuyển.

Adapter hiện chọn một provider cho toàn bộ attachment; không có dual-read tự động. Việc chuyển chỉ an toàn khi tất cả key còn được tham chiếu trong DB đã tồn tại và được xác minh ở provider đích.
