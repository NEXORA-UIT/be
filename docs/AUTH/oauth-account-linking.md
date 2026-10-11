# AUTH — chính sách Google/GitHub OAuth và liên kết tài khoản

**Trạng thái:** đề xuất để review. Áp dụng cho đăng nhập Google và GitHub; không áp dụng cho GitHub connector gắn repository vào Board.

## Định danh và dữ liệu

- Khóa nhận diện từ provider là `(provider, providerAccountId)`, lưu ở `OAuthAccount`. Không dùng email, tên hay avatar làm khóa nhận diện vì chúng có thể đổi.
- Ràng buộc ERD: duy nhất `(provider, providerAccountId)` và `(userId, provider)`. Một user có tối đa một liên kết cho mỗi provider.
- Chỉ lấy email từ thông tin provider đã xác minh. Nếu GitHub không cung cấp email đã xác minh, không tự tạo `User` vì ERD yêu cầu email duy nhất. Frontend hiển thị hướng dẫn cập nhật/xác minh email ở provider. Người dùng đang đăng nhập vẫn có thể chủ động liên kết provider bằng định danh provider, sau khi qua bước xác thực liên kết.
- Tài khoản tạo từ OAuth có `passwordHash = null`. Muốn đăng nhập bằng mật khẩu phải qua một luồng đặt mật khẩu có xác thực riêng; không tự sinh mật khẩu.

## Quy tắc đăng nhập

1. Backend kiểm tra `state` một lần, đổi authorization code với đúng provider và redirect URI trong config môi trường, rồi lấy provider account ID.
2. Nếu `OAuthAccount` đã tồn tại: đăng nhập user đã liên kết, trừ khi user bị khóa.
3. Nếu chưa tồn tại và email provider đã xác minh **chưa thuộc user nào**: tạo `User` và `OAuthAccount` trong cùng transaction, rồi cấp phiên.
4. **Google:** nếu Google trả email khớp `User` đã có và `email_verified = true`, liên kết Google `sub` vào user đó trong transaction rồi cấp phiên. Đây là phương án trải nghiệm bro vừa đề xuất; không dùng email làm khóa nhận diện cho các lần đăng nhập sau. Nếu email chưa xác minh, không tự liên kết.
5. **GitHub:** nếu email đã thuộc `User` khác, trả lỗi `ACCOUNT_LINK_REQUIRED`, không cấp token. Frontend yêu cầu đăng nhập tài khoản hiện có rồi liên kết chủ động.
6. Nếu provider account ID đã liên kết với user khác: không chuyển quyền sở hữu bằng luồng đăng nhập hay liên kết; trả lỗi xung đột.

## Liên kết chủ động

- Endpoint liên kết sẽ yêu cầu access token của user hiện tại và phiên đăng nhập gần đây (đề xuất tối đa 10 phút). Nếu quá hạn, frontend yêu cầu đăng nhập lại.
- User bắt đầu một OAuth authorization mới cho mục đích `link`; `state` ràng buộc provider, mục đích và user ID, lưu trong Redis có TTL ngắn và dùng một lần. Callback/code exchange xác minh lại user trước khi ghi `OAuthAccount`.
- Ghi liên kết trong transaction, dựa vào unique constraint để chống hai yêu cầu đồng thời. Không đổi email của `User` trong thao tác liên kết. Provider đã gắn với user khác hoặc user đã có provider đó thì trả conflict.
- Không đưa token đăng nhập của Nexora vào URL redirect. Kết quả code exchange trả token qua JSON theo API contract hiện có.

## Những cập nhật hợp đồng API cần review với frontend

- Google OAuth hiện có endpoint start cấp `state/loginToken`; callback nhận `code` và `state`. Redirect URI do backend lấy từ config môi trường.
- Bổ sung endpoint liên kết tài khoản có xác thực; xác định request/response và mã `ACCOUNT_LINK_REQUIRED`/conflict trong OpenAPI và endpoint matrix.
- OpenAPI cần mô tả Google tự liên kết **chỉ với email đã xác minh**; GitHub cần liên kết chủ động khi email trùng. Endpoint liên kết GitHub cụ thể vẫn cần một PR hợp đồng riêng để frontend review.

## Test chấp nhận tối thiểu

- Cùng provider ID đăng nhập lại đúng user, kể cả khi email provider thay đổi.
- Google có email đã xác minh trùng user cũ thì liên kết và cấp phiên đúng user; email chưa xác minh không được tự liên kết.
- GitHub có email trùng user cũ trả `ACCOUNT_LINK_REQUIRED`; không tạo thêm user, không cấp token.
- User đăng nhập và liên kết thành công với provider chưa gắn; liên kết vào user khác hoặc liên kết trùng bị từ chối.
- State sai/hết hạn/đã dùng, code bị dùng lại và user bị khóa đều không cấp phiên.
- GitHub thiếu email xác minh không tạo user mới; callback Google/GitHub không làm lộ token qua URL/log.
