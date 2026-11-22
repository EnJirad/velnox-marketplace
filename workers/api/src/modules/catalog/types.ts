export interface CategoryRecord {
  id: string;
  parentId: string | null;
  name: string;
  nameTh?: string | null;
  nameEn?: string | null;
  nameMy?: string | null;
  slug: string;
  level: number;
  iconUrl?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface CategoryTreeNode extends CategoryRecord {
  children: CategoryTreeNode[];
}

export interface ProductVariantRecord {
  id: string;
  productId: string;
  name: string;
  sku?: string | null;
  price: bigint | number; // satang
  stock: number;
  createdAt: string;
}

export interface ProductRecord {
  id: string;
  shopId: string;
  shopName?: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  price: bigint | number; // satang
  originalPrice?: bigint | number | null; // satang
  currency: string;
  totalQuantity: number;
  reservedQuantity: number;
  status: "draft" | "published" | "archived" | "delisted";
  images: string[];
  primaryImageUrl?: string | null;
  rating: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetailRecord extends ProductRecord {
  variants: ProductVariantRecord[];
  categoryPath?: Array<{ id: string; name: string; slug: string }>;
}

export interface ProductListFilter {
  q?: string;
  categoryId?: string;
  categorySlug?: string;
  minPrice?: number; // satang or THB decimal
  maxPrice?: number; // satang or THB decimal
  sort?: "popular" | "price_asc" | "price_desc" | "newest";
  page?: number;
  limit?: number;
  shopId?: string;
  status?: string;
}

export interface ShopRecord {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  description: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  status: "active" | "inactive" | "suspended";
  rating: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}
