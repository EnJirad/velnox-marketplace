# Media Storage

## Architecture

- **Cloudflare R2** stores binary files (images, documents)
- **Neon PostgreSQL** stores metadata in `media` table

## Media Table

```sql
media (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES users(id),
  object_key VARCHAR(500),  -- R2 object key
  cdn_url TEXT,             -- Public CDN URL
  mime_type VARCHAR(100),
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  status VARCHAR(20),
  created_at TIMESTAMPTZ
)
```

## Upload Flow

1. Frontend requests presigned upload URL from backend
2. Backend generates presigned URL using R2 SDK
3. Frontend uploads directly to R2 using presigned URL
4. Frontend notifies backend of completed upload
5. Backend creates media record in Neon

## File Types

- Avatars (user profile photos)
- Covers (shop cover images)
- Product images
- Shop logos
- Documents

## Rules

- Never expose R2 secrets to frontend
- Use backend-generated presigned URLs
- Store metadata in Neon, binaries in R2
