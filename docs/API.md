# Velnox API

## Base URL

```
Production: https://your-backend.onrender.com/api
Development: http://localhost:3001/api
```

## Response Format

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

## Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/google` | No | Redirect to Google OAuth |
| GET | `/api/auth/google/callback` | No | OAuth callback handler |
| GET | `/api/auth/me` | Yes | Get current user |
| POST | `/api/auth/logout` | No | Clear session cookie |

### Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/products` | No | List products (paginated, filterable) |
| GET | `/api/products/:id` | No | Get product by ID |
| GET | `/api/products/slug/:slug` | No | Get product by slug |

**Query Parameters for List:**
- `page` — Page number (default: 1)
- `pageSize` — Items per page (default: 12, max: 50)
- `search` — Text search in name/description
- `category` — Filter by category slug
- `featured` — Filter featured products (`true`)

### Categories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/categories` | No | List all categories |

### Cart

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/cart` | Yes | Get current user's cart |
| POST | `/api/cart/items` | Yes | Add item to cart |
| PATCH | `/api/cart/items/:itemId` | Yes | Update item quantity |
| DELETE | `/api/cart/items/:itemId` | Yes | Remove item from cart |

### Shops

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/shops` | No | List shops |
| GET | `/api/shops/:slug` | No | Get shop by slug |

### Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orders` | Yes | List user's orders |
| POST | `/api/orders` | Yes | Create order |
| GET | `/api/orders/:id` | Yes | Get order by ID |

### Addresses

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/addresses` | Yes | List user's addresses |
| POST | `/api/addresses` | Yes | Create address |
| PUT | `/api/addresses/:id` | Yes | Update address |
| DELETE | `/api/addresses/:id` | Yes | Delete address |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check with DB status |

## Rate Limiting

Planned: 100 requests per minute per IP for unauthenticated, 300 for authenticated.

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Not authenticated |
| `INVALID_TOKEN` | Invalid or expired JWT |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid request body |
| `CONFLICT` | Resource already exists |
| `INTERNAL_ERROR` | Server error |
