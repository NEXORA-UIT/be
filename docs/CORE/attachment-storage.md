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

Adapter dùng region `auto`, giữ nguyên storage key UUID của Attachment và coi lệnh xóa lặp là an toàn. Khi upload ghi object thành công nhưng ghi DB thất bại, `PendingObjectCleanup` tiếp tục giữ key để có thể retry.

## Quyết định cho luồng xóa tệp

**Sẽ dùng cronjob để dọn object bất đồng bộ. Chưa triển khai cronjob trong code hiện tại.** Hiện tại xóa Card Attachment và xóa vĩnh viễn Board vẫn gọi `storage.delete` trong transaction PostgreSQL. Nếu object đã bị xóa nhưng transaction rollback, hoặc xóa nhiều object rồi một lần xóa sau thất bại, DB có thể còn bản ghi trỏ đến tệp đã mất. Xóa lặp an toàn không khắc phục được khoảng thời gian dữ liệu bị lệch này.

Khi triển khai cronjob, luồng xóa cần đi theo thứ tự:

1. Trong **cùng transaction DB**, kiểm tra quyền và trạng thái archive, đánh dấu tệp không còn được phục vụ, rồi ghi `storageKey` vào hàng đợi cleanup bền vững. Với Board, phải ghi đủ key của mọi Attachment trước khi xóa các hàng quan hệ; với Attachment đơn lẻ, phải giữ metadata cần cho lịch sử theo quy tắc nghiệp vụ.
2. Chỉ sau khi transaction commit, cronjob mới xóa object. Worker chỉ nhận các key đã được xác nhận không còn tham chiếu bởi Attachment đang hoạt động; nhiều worker không được xử lý cùng một mục đồng thời.
3. Chỉ xóa mục cleanup sau khi provider xác nhận xóa thành công. Lỗi tạm thời phải giữ mục để retry với giới hạn tốc độ/backoff và có log, số lần thử, thời điểm lỗi cuối để vận hành kiểm tra. Xóa object không tồn tại được xem là thành công.
4. Nếu DB rollback, không tạo mục cleanup và không đụng đến object. Nếu cronjob dừng sau khi xóa object nhưng trước khi xác nhận trong DB, lần chạy sau xóa lặp rồi hoàn tất mục cleanup.

`PendingObjectCleanup` hiện mới hỗ trợ dọn object mồ côi khi **upload thành công nhưng ghi DB thất bại**; chưa đại diện đầy đủ cho trạng thái xóa Attachment/Board. Không chuyển luồng xóa hiện tại sang cronjob bằng cách chỉ chạy `retryPendingObjectCleanups` theo lịch. Cần thiết kế thêm trạng thái xóa, transaction ghi cleanup, xử lý đồng thời và test các điểm lỗi trước khi bật cronjob. Quyết định này không phụ thuộc BullMQ.

## Chuyển dữ liệu filesystem hiện có

Chưa có bằng chứng trong repository để khẳng định production đang có hoặc không có blob filesystem. Trước khi đổi provider, người triển khai phải đối chiếu các hàng `Attachment` có `storageKey` với thư mục filesystem thực tế của production. Không được bật R2 nếu còn attachment cũ mà object tương ứng chưa đọc được từ bucket.

Nếu production chưa có attachment filesystem, ghi nhận kết quả kiểm kê và bật R2 với cấu hình đã kiểm tra. Nếu có dữ liệu, lập cửa sổ bảo trì để ngừng upload/xóa attachment, sao chép từng object sang bucket với **cùng storage key**, đối chiếu số lượng và checksum, thử tải các object đại diện, rồi mới đổi provider và khởi động lại dịch vụ. Giữ bản filesystem gốc cho đến khi xác minh được tải xuống qua R2 và có bản sao lưu. Nếu thiếu object, lệch checksum hoặc không thể đọc, giữ provider cũ và khắc phục trước khi chuyển.

Adapter hiện chọn một provider cho toàn bộ attachment; không có dual-read tự động. Do đó, việc chuyển chỉ an toàn khi tất cả key còn được tham chiếu trong DB đã tồn tại và được xác minh ở provider đích.
