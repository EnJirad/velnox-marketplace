import type { DbQueryable } from "../../../../database/src/types.ts";
import type { User, UserRole, UserStatus } from "../domain/user.ts";

export interface CreateUserData {
  readonly email: string;
  readonly name: string;
  readonly passwordHash?: string | null;
  readonly role?: UserRole;
  readonly status?: UserStatus;
}

export class UserRepository {
  public static async findByEmail(
    db: DbQueryable,
    email: string,
  ): Promise<User | null> {
    const res = await db.query(
      `SELECT id, email, name, role, status, password_hash, created_at, updated_at
       FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;`,
      [email.trim()],
    );

    if (!res.rows || res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public static async findById(
    db: DbQueryable,
    id: string,
  ): Promise<User | null> {
    const res = await db.query(
      `SELECT id, email, name, role, status, password_hash, created_at, updated_at
       FROM users WHERE id = $1 LIMIT 1;`,
      [id],
    );

    if (!res.rows || res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public static async createUser(
    db: DbQueryable,
    data: CreateUserData,
  ): Promise<User> {
    const res = await db.query(
      `INSERT INTO users (email, name, password_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id, email, name, role, status, password_hash, created_at, updated_at;`,
      [
        data.email.trim().toLowerCase(),
        data.name.trim(),
        data.passwordHash ?? null,
        data.role ?? "customer",
        data.status ?? "active",
      ],
    );

    return this.mapRow(res.rows[0]);
  }

  public static async createCustomerProfile(
    db: DbQueryable,
    userId: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO customer_profiles (id, user_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, NOW(), NOW())
       ON CONFLICT (user_id) DO NOTHING;`,
      [userId],
    );
  }

  public static async findAuthIdentity(
    db: DbQueryable,
    provider: string,
    providerId: string,
  ): Promise<{ userId: string } | null> {
    const res = await db.query(
      `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_id = $2 LIMIT 1;`,
      [provider, providerId],
    );
    if (!res.rows || res.rows.length === 0) return null;
    return { userId: res.rows[0].user_id };
  }

  public static async linkAuthIdentity(
    db: DbQueryable,
    params: { userId: string; provider: string; providerId: string; email: string },
  ): Promise<void> {
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_id, email, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (provider, provider_id) DO NOTHING;`,
      [params.userId, params.provider, params.providerId, params.email.toLowerCase()],
    );
  }

  private static mapRow(row: any): User {
    return {
      id: String(row.id),
      email: String(row.email),
      name: row.name ? String(row.name) : null,
      role: row.role as UserRole,
      status: row.status as UserStatus,
      passwordHash: row.password_hash ? String(row.password_hash) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
