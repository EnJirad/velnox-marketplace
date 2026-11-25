export type BusinessType = "individual" | "juristic";
export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
export type ShopStatus = "active" | "inactive" | "suspended";

export interface SellerProfileRecord {
  id: string;
  userId: string;
  businessName: string;
  businessType: BusinessType;
  taxId?: string | null;
  idCardNumber?: string | null;
  verificationStatus: VerificationStatus;
  status?: string;
  verificationRejectedReason?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopAddress {
  line1?: string;
  line2?: string;
  subdistrict?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ShopRecord {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  description: string;
  category?: string | null;
  phone?: string | null;
  address?: ShopAddress | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  status: ShopStatus;
  rating: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApplySellerInput {
  shopName: string;
  shopSlug?: string;
  shopDescription?: string;
  shopCategory?: string;
  shopAddress?: ShopAddress;
  firstName?: string;
  lastName?: string;
  phone?: string;
  idNumber?: string;
  idCardNumber?: string;
  idCardFrontUrl?: string | null;
  idCardBackUrl?: string | null;
  selfieUrl?: string | null;
  identityEvidence?: string[];
  businessName?: string;
  businessType?: BusinessType;
  taxId?: string;
}

export interface UpdateShopInput {
  name?: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
}

export interface CreateProductVariantInput {
  name: string;
  sku?: string;
  price: number; // in THB or satang
  stock: number;
}

export interface CreateProductInput {
  name: string;
  slug?: string;
  description?: string;
  categoryId: string;
  price: number; // in THB decimal (e.g. 299.00)
  originalPrice?: number;
  currency?: string;
  totalQuantity: number;
  images?: string[];
  primaryImageUrl?: string;
  variants?: CreateProductVariantInput[];
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  categoryId?: string;
  price?: number;
  originalPrice?: number;
  totalQuantity?: number;
  status?: "draft" | "published" | "archived" | "delisted";
  images?: string[];
  primaryImageUrl?: string;
}
