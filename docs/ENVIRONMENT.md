# Environment Variables

## Frontend (Vercel)

Only one variable needed per app:

```
VITE_API_URL=http://localhost:3001/api
```

**NEVER put server secrets in frontend environment variables.**

## Backend (Render)

All secrets live here:

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | Neon PostgreSQL connection string | Yes |
| GOOGLE_CLIENT_ID | Google OAuth client ID | Yes |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret | Yes |
| JWT_SECRET | JWT signing secret (64+ chars) | Yes |
| R2_ACCOUNT_ID | Cloudflare account ID | Yes |
| R2_ACCESS_KEY_ID | R2 API access key | Yes |
| R2_SECRET_ACCESS_KEY | R2 API secret key | Yes |
| R2_BUCKET | R2 bucket name | Yes |
| R2_PUBLIC_DOMAIN | R2 public URL | Yes |
| CORS_ORIGINS | Comma-separated allowed origins | Yes |
| PORT | Server port (default: 3001) | No |

## Security Rules

- Never commit .env files
- Never put DATABASE_URL, JWT_SECRET, or R2 secrets in frontend code
- Use VITE_ prefix ONLY for VITE_API_URL
- Backend reads secrets via process.env
