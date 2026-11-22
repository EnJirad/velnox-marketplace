import type { ISellerRepository } from "./seller-repository.js";
import type {
  ApplySellerInput,
  CreateProductInput,
  SellerProfileRecord,
  ShopRecord,
  UpdateProductInput,
  UpdateShopInput,
} from "./types.js";
import type { ProductDetailRecord, ProductRecord } from "../catalog/types.js";

export class SellerService {
  constructor(private readonly repo: ISellerRepository) {}

  async applySeller(
    userId: string,
    input: ApplySellerInput,
  ): Promise<{ seller: SellerProfileRecord; shop: ShopRecord }> {
    const existing = await this.repo.getSellerByUserId(userId);
    if (existing) {
      throw new Error("User has already registered as a seller");
    }

    if (!input.businessName || !input.shopName || !input.shopSlug) {
      throw new Error("Business name, shop name, and shop slug are required");
    }

    return this.repo.createSellerAndShop(userId, input);
  }

  async getSellerProfile(userId: string): Promise<{ seller: SellerProfileRecord; shop: ShopRecord | null } | null> {
    const seller = await this.repo.getSellerByUserId(userId);
    if (!seller) return null;
    const shop = await this.repo.getShopBySellerId(seller.id);
    return { seller, shop };
  }

  async updateShop(userId: string, input: UpdateShopInput): Promise<ShopRecord> {
    const seller = await this.repo.getSellerByUserId(userId);
    if (!seller) throw new Error("Seller profile not found");

    const shop = await this.repo.getShopBySellerId(seller.id);
    if (!shop) throw new Error("Shop not found for this seller");

    return this.repo.updateShop(shop.id, input);
  }

  async createProduct(userId: string, input: CreateProductInput): Promise<ProductDetailRecord> {
    const seller = await this.repo.getSellerByUserId(userId);
    if (!seller) throw new Error("Seller profile not found. Please apply as a seller first.");

    const shop = await this.repo.getShopBySellerId(seller.id);
    if (!shop) throw new Error("Active shop not found for this seller.");

    if (shop.status === "suspended") {
      throw new Error("Shop is suspended and cannot add new products.");
    }

    return this.repo.createProduct(shop.id, input);
  }

  async updateProduct(userId: string, productId: string, input: UpdateProductInput): Promise<ProductRecord> {
    const seller = await this.repo.getSellerByUserId(userId);
    if (!seller) throw new Error("Seller profile not found");

    const shop = await this.repo.getShopBySellerId(seller.id);
    if (!shop) throw new Error("Shop not found");

    const product = await this.repo.getProductById(productId);
    if (!product) throw new Error("Product not found");

    if (product.shopId !== shop.id) {
      throw new Error("Forbidden: You do not own this product");
    }

    return this.repo.updateProduct(productId, input);
  }

  async deleteProduct(userId: string, productId: string): Promise<boolean> {
    const seller = await this.repo.getSellerByUserId(userId);
    if (!seller) throw new Error("Seller profile not found");

    const shop = await this.repo.getShopBySellerId(seller.id);
    if (!shop) throw new Error("Shop not found");

    const product = await this.repo.getProductById(productId);
    if (!product) throw new Error("Product not found");

    if (product.shopId !== shop.id) {
      throw new Error("Forbidden: You do not own this product");
    }

    return this.repo.deleteProduct(productId);
  }
}
