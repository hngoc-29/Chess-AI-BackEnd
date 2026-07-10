# Migration từ Supabase sang Turso DB + JWT Auth

## Tổng quan

Migration này thay thế hoàn toàn Supabase bằng:
- **Turso DB** (LibSQL) - database distributed, hiệu năng cao
- **JWT Authentication** - authentication tự quản lý với bcrypt

## Các thay đổi chính

### 1. Dependencies mới
```bash
npm install @libsql/client jsonwebtoken bcrypt
npm install --save-dev @types/jsonwebtoken @types/bcrypt
```

### 2. Files mới được tạo
- `src/db/turso.ts` - Turso database client
- `src/auth/jwt.ts` - JWT utilities (generate, verify tokens, hash passwords)
- `sql/turso-schema.sql` - SQLite schema cho Turso

### 3. Files được cập nhật
- `src/config/env.ts` - Thay env vars Supabase → Turso + JWT
- `src/auth/verifyToken.ts` - Dùng JWT thay vì Supabase Auth
- `src/auth/ensureProfile.ts` - Dùng Turso queries
- `src/middleware/httpAuth.ts` - Dùng JWT verification
- `src/routes/auth.routes.ts` - Thêm `/register`, `/login`, `/refresh` endpoints
- `src/services/matchService.ts` - Dùng Turso transactions
- `src/services/campaignService.ts` - Dùng Turso queries
- `src/socket/authMiddleware.ts` - Dùng JWT verification
- `src/routes/matches.routes.ts` - Dùng Turso queries
- `src/routes/campaign.routes.ts` - Dùng Turso queries
- `.env.example` - Cập nhật env vars

## Setup Instructions

### Bước 1: Cài đặt Turso CLI

```bash
# macOS/Linux
curl -sSfL https://get.tur.so/install.sh | bash

# Hoặc với Homebrew (macOS)
brew install tursodatabase/tap/turso
```

### Bước 2: Tạo Turso Database

```bash
# Đăng nhập Turso (cần tạo account tại turso.tech trước)
turso auth login

# Tạo database
turso db create chess-online

# Lấy database URL
turso db show chess-online --url
# Output: libsql://chess-online-[your-org].turso.io

# Tạo auth token
turso db tokens create chess-online
# Output: eyJhbGc... (copy token này)
```

### Bước 3: Khởi tạo Schema

```bash
# Apply schema vào database
turso db shell chess-online < sql/turso-schema.sql

# Hoặc chạy từng lệnh manually:
turso db shell chess-online
# Rồi paste nội dung từ sql/turso-schema.sql
```

### Bước 4: Generate JWT Secrets

```bash
# Generate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT_REFRESH_SECRET (chạy lại lệnh trên để tạo secret khác)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Bước 5: Cấu hình Environment Variables

Tạo file `.env` từ `.env.example`:

```bash
cp .env.example .env
```

Điền các giá trị:

```env
# Turso Database
TURSO_DATABASE_URL=libsql://chess-online-[your-org].turso.io
TURSO_AUTH_TOKEN=eyJhbGc... (token từ bước 2)

# JWT Secrets
JWT_SECRET=... (secret từ bước 4)
JWT_REFRESH_SECRET=... (secret khác từ bước 4)
```

### Bước 6: Build và chạy server

```bash
# Type check
npm run typecheck

# Development mode
npm run dev

# Production build
npm run build
npm start
```

## API Changes

### Authentication Endpoints (mới)

#### 1. Register (POST /auth/register)
```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "PlayerName" // optional
}
```

Response:
```json
{
  "user": {
    "id": "...",
    "email": "user@example.com",
    "displayName": "PlayerName",
    "elo": 1200
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

#### 2. Login (POST /auth/login)
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Response: (giống register)

#### 3. Refresh Token (POST /auth/refresh)
```json
{
  "refreshToken": "eyJhbGc..."
}
```

Response:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

#### 4. Get Profile (GET /auth/me)
Headers: `Authorization: Bearer <accessToken>`

Response:
```json
{
  "user": {
    "id": "...",
    "display_name": "PlayerName",
    "elo": 1200,
    "avatar_url": null
  }
}
```

## Flutter App Changes Needed

### 1. Thay đổi authentication flow

```dart
// Trước (Supabase):
final response = await Supabase.instance.client.auth.signInWithPassword(
  email: email,
  password: password,
);
final accessToken = response.session?.accessToken;

// Sau (JWT):
final response = await http.post(
  Uri.parse('$API_URL/auth/login'),
  body: jsonEncode({'email': email, 'password': password}),
  headers: {'Content-Type': 'application/json'},
);
final data = jsonDecode(response.body);
final accessToken = data['accessToken'];
final refreshToken = data['refreshToken'];
```

### 2. Lưu tokens

```dart
// Lưu accessToken và refreshToken vào secure storage
await secureStorage.write(key: 'accessToken', value: accessToken);
await secureStorage.write(key: 'refreshToken', value: refreshToken);
```

### 3. WebSocket connection

```dart
// Trước:
socket = io('$WS_URL', <String, dynamic>{
  'auth': {'token': supabaseAccessToken},
  'transports': ['websocket'],
});

// Sau: (chỉ đổi tên variable, logic giống)
socket = io('$WS_URL', <String, dynamic>{
  'auth': {'token': jwtAccessToken}, // JWT access token
  'transports': ['websocket'],
});
```

## Verification

### Test các endpoints:

```bash
# Register
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Login
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Get profile (thay YOUR_ACCESS_TOKEN)
curl http://localhost:8080/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Lợi ích của Turso

1. **Distributed** - Edge database với latency thấp
2. **SQLite-compatible** - Syntax quen thuộc, dễ migrate
3. **Embedded replicas** - Có thể embed database vào app
4. **Free tier** - 9GB storage, 1 billion row reads/month
5. **Không phụ thuộc vendor** - Có thể self-host LibSQL

## Troubleshooting

### Lỗi: "User profile not found"
→ User chưa được tạo trong database. Đảm bảo đã register qua `/auth/register`

### Lỗi: "Invalid or expired token"
→ JWT token hết hạn hoặc không hợp lệ. Dùng `/auth/refresh` để lấy token mới

### Lỗi khi connect Turso
→ Kiểm tra `TURSO_DATABASE_URL` và `TURSO_AUTH_TOKEN` trong `.env`

## Migration từ Supabase (nếu có data cũ)

Nếu bạn có data trong Supabase cần migrate sang Turso, bạn cần:

1. Export data từ Supabase (dùng pg_dump hoặc Supabase dashboard)
2. Convert PostgreSQL data sang SQLite format
3. Import vào Turso bằng `turso db shell`

**Lưu ý**: Schema đã thay đổi:
- UUID → TEXT
- BOOLEAN → INTEGER (0/1)
- timestamptz → TEXT (ISO8601)
- User passwords cần được re-hash với bcrypt

## Support

Nếu gặp vấn đề, check:
- Turso docs: https://docs.turso.tech/
- LibSQL docs: https://github.com/tursodatabase/libsql
