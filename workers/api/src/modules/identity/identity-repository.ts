import type { IDatabaseClient } from "../../core/database/db-client.js";
import type {
  AuthIdentityRecord,
  NewAuthIdentity,
  NewRefreshToken,
  NewUser,
  RefreshTokenRecord,
  UserRecord,
} from "./types.js";

export interface IIdentityRepository {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createUser(user: NewUser): Promise<UserRecord>;
  createIdentity(identity: NewAuthIdentity): Promise<AuthIdentityRecord>;
  findIdentity(provider: string, providerUserId: string): Promise<AuthIdentityRecord | null>;
  createRefreshToken(token: NewRefreshToken): Promise<RefreshTokenRecord>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeRefreshToken(tokenHash: string): Promise<void>;
  revokeAllUserRefreshTokens(userId: string): Promise<void>;
}

/**
 * PostgreSQL Implementation of IIdentityRepository
 */
export class SqlIdentityRepository implements IIdentityRepository {
  constructor(private readonly db: IDatabaseClient) {}

  async findUserById(id: string): Promise<UserRecord | null> {
    const res = await this.db.query<UserRecord>(
      `SELECT * FROM users WHERE id = $1 LIMIT 1;`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const res = await this.db.query<UserRecord>(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
      [email],
    );
    return res.rows[0] ?? null;
  }

  async createUser(user: NewUser): Promise<UserRecord> {
    const res = await this.db.query<UserRecord>(
      `INSERT INTO users (email, name, role, password_hash, avatar_url, phone)
       VALUES (LOWER($1), $2, $3, $4, $5, $6)
       RETURNING *;`,
      [
        user.email,
        user.name,
        user.role ?? "customer",
        user.password_hash ?? null,
        user.avatar_url ?? null,
        user.phone ?? null,
      ],
    );
    return res.rows[0]!;
  }

  async createIdentity(identity: NewAuthIdentity): Promise<AuthIdentityRecord> {
    const res = await this.db.query<AuthIdentityRecord>(
      `INSERT INTO auth_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, $2, $3, LOWER($4))
       RETURNING *;`,
      [identity.user_id, identity.provider, identity.provider_user_id, identity.email],
    );
    return res.rows[0]!;
  }

  async findIdentity(provider: string, providerUserId: string): Promise<AuthIdentityRecord | null> {
    const res = await this.db.query<AuthIdentityRecord>(
      `SELECT * FROM auth_identities WHERE provider = $1 AND provider_user_id = $2 LIMIT 1;`,
      [provider, providerUserId],
    );
    return res.rows[0] ?? null;
  }

  async createRefreshToken(token: NewRefreshToken): Promise<RefreshTokenRecord> {
    const res = await this.db.query<RefreshTokenRecord>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *;`,
      [token.user_id, token.token_hash, token.expires_at],
    );
    return res.rows[0]!;
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const res = await this.db.query<RefreshTokenRecord>(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1;`,
      [tokenHash],
    );
    return res.rows[0] ?? null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1;`,
      [tokenHash],
    );
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1;`,
      [userId],
    );
  }
}

/**
 * Isolated In-Memory Mock Repository for Unit Testing
 */
export class InMemoryIdentityRepository implements IIdentityRepository {
  private users: Map<string, UserRecord> = new Map();
  private identities: Map<string, AuthIdentityRecord> = new Map();
  private refreshTokens: Map<string, RefreshTokenRecord> = new Map();

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === normalized) return u;
    }
    return null;
  }

  async createUser(user: NewUser): Promise<UserRecord> {
    const id = crypto.randomUUID();
    const record: UserRecord = {
      id,
      email: user.email.toLowerCase(),
      name: user.name,
      avatar_url: user.avatar_url ?? null,
      phone: user.phone ?? null,
      role: user.role ?? "customer",
      status: "active",
      password_hash: user.password_hash ?? null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.users.set(id, record);
    return record;
  }

  async createIdentity(identity: NewAuthIdentity): Promise<AuthIdentityRecord> {
    const id = crypto.randomUUID();
    const record: AuthIdentityRecord = {
      id,
      user_id: identity.user_id,
      provider: identity.provider,
      provider_user_id: identity.provider_user_id,
      email: identity.email.toLowerCase(),
      created_at: new Date(),
    };
    this.identities.set(`${identity.provider}:${identity.provider_user_id}`, record);
    return record;
  }

  async findIdentity(provider: string, providerUserId: string): Promise<AuthIdentityRecord | null> {
    return this.identities.get(`${provider}:${providerUserId}`) ?? null;
  }

  async createRefreshToken(token: NewRefreshToken): Promise<RefreshTokenRecord> {
    const id = crypto.randomUUID();
    const record: RefreshTokenRecord = {
      id,
      user_id: token.user_id,
      token_hash: token.token_hash,
      revoked: false,
      expires_at: token.expires_at,
      created_at: new Date(),
    };
    this.refreshTokens.set(token.token_hash, record);
    return record;
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.refreshTokens.get(tokenHash) ?? null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const token = this.refreshTokens.get(tokenHash);
    if (token) {
      token.revoked = true;
    }
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    for (const t of this.refreshTokens.values()) {
      if (t.user_id === userId) {
        t.revoked = true;
      }
    }
  }
}
