const DEFAULT_STATE_TTL_SECONDS = 600;

function parseStateTtl(value: string | undefined) {
  const ttlSeconds = Number(value ?? DEFAULT_STATE_TTL_SECONDS);
  return Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_STATE_TTL_SECONDS;
}

export const oauthConfig = {
  // ID công khai của ứng dụng Web trên Google Cloud.
  // Ví dụ: "123456789-abc.apps.googleusercontent.com".
  googleClientId: process.env.GOOGLE_CLIENT_ID,

  // Secret của ứng dụng Web trên Google Cloud. Chỉ backend được giữ giá trị này.
  // Ví dụ: "GOCSPX-...". Không commit secret thật lên Git.
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,

  // Địa chỉ frontend mà Google đưa trình duyệt quay về sau khi đăng nhập.
  // Mỗi môi trường có một URL riêng, ví dụ local dùng:
  // "http://localhost:5173/oauth/callback/google".
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,

  // Số giây loginToken/state được giữ trong Redis. Ví dụ 600 = 10 phút.
  stateTtlSeconds: parseStateTtl(process.env.OAUTH_STATE_TTL_SECONDS),
};
