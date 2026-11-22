import type { DbQueryable } from "../../../../database/src/types.ts";

export interface RevokeTokenParams {
  readonly tokenId: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

/**
 * Token Repository managing revoked token IDs (JTIs) in PostgreSQL with an in-memory hot cache.
 */
export class TokenRepository {
  private static inMemoryRevokedJtis: Set<string> = new Set<string>();

  /**
   * Records a token as revoked in `revoked_tokens` table.
   */
  public static async revokeToken(
    db: DbQueryable,
    params: RevokeTokenParams,
  ): Promise<void> {
    this.inMemoryRevokedJtis.add(params.tokenId);

    const sql = `
      INSERT INTO revoked_tokens (token_id, user_id, revoked_at, expires_at)
      VALUES ($1, $2, NOW(), $3)
      ON CONFLICT (token_id) DO NOTHING;
    `;
    await db.query(sql, [params.tokenId, params.userId, params.expiresAt.toISOString()]);
  }

  /**
   * Checks whether a token ID (jti) has been revoked.
   */
  public static async isRevoked(
    db: DbQueryable,
    tokenId: string,
  ): Promise<boolean> {
    if (this.inMemoryRevokedJtis.has(tokenId)) {
      return true;
    }

    const res = await db.query(
      `SELECT 1 FROM revoked_tokens WHERE token_id = $1 LIMIT 1;`,
      [tokenId],
    );

    if (res.rows && res.rows.length > 0) {
      this.inMemoryRevokedJtis.add(tokenId);
      return true;
    }

    return false;
  }

  /**
   * Clears the in-memory cache (primarily for tests).
   */
  public static clearCache(): void {
    this.inMemoryRevokedJtis.clear();
  }
}
