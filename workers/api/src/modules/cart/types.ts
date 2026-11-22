export interface CartRecord {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CartItemRecord {
  id: string;
  cartId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  // Enriched catalog fields
  productName?: string;
  variantName?: string | null;
  shopId?: string;
  shopName?: string;
  priceSatang?: number;
  imageUrl?: string | null;
  stockAvailable?: number;
}

export interface AddCartItemData {
  productId: string;
  variantId?: string;
  quantity: number;
}
