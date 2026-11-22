import type { DbQueryable } from "../../../../database/src/types.ts";
import { type Category, buildCategoryTree, type CategoryTreeNode } from "../domain/category.ts";

export class CategoryRepository {
  public static async findAllActive(db: DbQueryable): Promise<readonly Category[]> {
    const res = await db.query(
      `SELECT id, slug, names, parent_id, sort_order, icon, image_url, is_active
       FROM categories
       WHERE is_active = true
       ORDER BY sort_order ASC, slug ASC;`,
    );

    return res.rows.map(this.mapRow);
  }

  public static async findTree(db: DbQueryable): Promise<readonly CategoryTreeNode[]> {
    const categories = await this.findAllActive(db);
    return buildCategoryTree(categories);
  }

  public static async findBySlug(db: DbQueryable, slug: string): Promise<Category | null> {
    const res = await db.query(
      `SELECT id, slug, names, parent_id, sort_order, icon, image_url, is_active
       FROM categories
       WHERE slug = $1 AND is_active = true
       LIMIT 1;`,
      [slug.trim().toLowerCase()],
    );

    if (!res.rows || res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  private static mapRow(row: any): Category {
    return {
      id: String(row.id),
      slug: String(row.slug),
      names: typeof row.names === "string" ? JSON.parse(row.names) : (row.names ?? {}),
      parentId: row.parent_id ? String(row.parent_id) : null,
      sortOrder: Number(row.sort_order ?? 0),
      icon: row.icon ? String(row.icon) : null,
      imageUrl: row.image_url ? String(row.image_url) : null,
      isActive: Boolean(row.is_active),
    };
  }
}
