# Velnox File Storage

## Overview

Velnox uses Cloudflare R2 for all file storage. R2 is S3-compatible, cost-effective, and globally distributed.

## Architecture

```
Frontend → Backend API → Generate Presigned URL → Frontend uploads to R2
→ Frontend notifies Backend → Backend creates media record in Neon
```

## What's Stored

| Type | Purpose |
|------|---------|
| Avatar | User profile pictures |
| Cover | Shop cover images |
| Product Images | Product photos |
| Shop Logo | Shop branding |
| Documents | Seller verification docs |

## Presigned URL Flow

1. Frontend requests upload URL from backend
2. Backend generates presigned URL using R2 credentials
3. Frontend uploads directly to R2 using presigned URL
4. Frontend notifies backend of successful upload
5. Backend creates `media` record in Neon

## Security

- R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are backend-only
- Presigned URLs are time-limited (typically 5 minutes)
- Browser never has direct access to R2 credentials
- Content-Type validation on backend before generating URLs

## Media Table

```sql
CREATE TABLE media (
    id UUID PRIMARY KEY,
    url TEXT NOT NULL,        -- Public URL (R2 public domain)
    key TEXT NOT NULL UNIQUE, -- R2 object key
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by UUID,         -- User who uploaded
    created_at TIMESTAMPTZ
);
```

## Environment Variables

```
R2_ACCOUNT_ID=         — Cloudflare account ID
R2_ACCESS_KEY_ID=      — R2 API access key
R2_SECRET_ACCESS_KEY=  — R2 API secret key
R2_BUCKET=             — Bucket name
R2_PUBLIC_DOMAIN=      — Public URL domain (e.g., pub-xxx.r2.dev)
```

## Allowed File Types

- image/jpeg
- image/png
- image/webp
- image/gif

## Size Limits

- Maximum file size: 5MB
- Maximum images per product: 10
