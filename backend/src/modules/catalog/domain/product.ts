export type ProductStatus = "draft" | "published" | "archived" | "moderation_rejected";

export interface ProductVariant {
  readonly id: string;
  readonly productId: string;
  readonly title: string;
  readonly sku: string | null;
  readonly priceMinor: bigint;
  readonly stock: number;
  readonly imageUrl: string | null;
}

export interface Product {
  readonly id: string;
  readonly shopId: string;
  readonly categoryId: string; // Stored as category slug in db
  readonly title: string;
  readonly description: string;
  readonly priceMinor: bigint;
  readonly status: ProductStatus;
  readonly images: readonly string[];
  readonly rating: number;
  readonly salesCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProductDetail extends Product {
  readonly shop: {
    readonly id: string;
    readonly name: string;
    readonly isVerified: boolean;
  };
  readonly category: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  };
  readonly stock: number;
  readonly variants: readonly ProductVariant[];
}

export interface ProductFilters {
  readonly categorySlug?: string;
  readonly search?: string;
  readonly minPriceMinor?: bigint;
  readonly maxPriceMinor?: bigint;
  readonly shopId?: string;
  readonly page?: number;
  readonly limit?: number;
}
