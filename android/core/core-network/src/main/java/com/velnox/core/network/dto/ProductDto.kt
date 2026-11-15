package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Product DTOs matching the backend API structure.
 * Based on backend routes: GET /api/products, GET /api/products/:id
 */

data class ProductListItemDto(
    @Json(name = "id") val id: String,
    @Json(name = "slug") val slug: String,
    @Json(name = "name") val name: String,
    @Json(name = "description") val description: String,
    @Json(name = "price") val price: String, // Decimal as string
    @Json(name = "original_price") val originalPrice: String?,
    @Json(name = "discount_percent") val discountPercent: Int?,
    @Json(name = "currency") val currency: String = "THB",
    @Json(name = "images") val images: List<String>,
    @Json(name = "thumbnail") val thumbnail: String?,
    @Json(name = "shop_id") val shopId: String,
    @Json(name = "shop_name") val shopName: String,
    @Json(name = "shop_slug") val shopSlug: String,
    @Json(name = "category_id") val categoryId: String,
    @Json(name = "category_slug") val categorySlug: String,
    @Json(name = "category_name") val categoryName: String,
    @Json(name = "rating") val rating: Double?,
    @Json(name = "review_count") val reviewCount: Int,
    @Json(name = "is_featured") val isFeatured: Boolean,
    @Json(name = "status") val status: String,
    @Json(name = "stock") val stock: Int,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class ProductDetailDto(
    @Json(name = "id") val id: String,
    @Json(name = "slug") val slug: String,
    @Json(name = "name") val name: String,
    @Json(name = "description") val description: String,
    @Json(name = "price") val price: String,
    @Json(name = "original_price") val originalPrice: String?,
    @Json(name = "discount_percent") val discountPercent: Int?,
    @Json(name = "currency") val currency: String = "THB",
    @Json(name = "images") val images: List<ProductImageDto>,
    @Json(name = "shop") val shop: ShopSummaryDto,
    @Json(name = "category") val category: CategorySummaryDto,
    @Json(name = "variants") val variants: List<ProductVariantDto>,
    @Json(name = "options") val options: List<ProductOptionDto>,
    @Json(name = "rating") val rating: Double?,
    @Json(name = "review_count") val reviewCount: Int,
    @Json(name = "is_featured") val isFeatured: Boolean,
    @Json(name = "status") val status: String,
    @Json(name = "total_stock") val totalStock: Int,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class ProductImageDto(
    @Json(name = "id") val id: String,
    @Json(name = "url") val url: String,
    @Json(name = "alt") val alt: String,
    @Json(name = "sort_order") val sortOrder: Int,
    @Json(name = "image_type") val imageType: String,
    @Json(name = "variant_id") val variantId: String?
)

data class ShopSummaryDto(
    @Json(name = "id") val id: String,
    @Json(name = "slug") val slug: String,
    @Json(name = "name") val name: String,
    @Json(name = "logo_url") val logoUrl: String?,
    @Json(name = "cover_url") val coverUrl: String?,
    @Json(name = "rating") val rating: Double?,
    @Json(name = "review_count") val reviewCount: Int,
    @Json(name = "is_verified") val isVerified: Boolean
)

data class CategorySummaryDto(
    @Json(name = "id") val id: String,
    @Json(name = "slug") val slug: String,
    @Json(name = "name") val name: String,
    @Json(name = "icon") val icon: String?,
    @Json(name = "parent_id") val parentId: String?
)

data class ProductVariantDto(
    @Json(name = "id") val id: String,
    @Json(name = "sku") val sku: String,
    @Json(name = "price") val price: String,
    @Json(name = "original_price") val originalPrice: String?,
    @Json(name = "stock") val stock: Int,
    @Json(name = "attributes") val attributes: Map<String, String>,
    @Json(name = "images") val images: List<String>
)

data class ProductOptionDto(
    @Json(name = "id") val id: String,
    @Json(name = "name") val name: String,
    @Json(name = "type") val type: String, // "image" or "text"
    @Json(name = "values") val values: List<ProductOptionValueDto>
)

data class ProductOptionValueDto(
    @Json(name = "id") val id: String,
    @Json(name = "value") val value: String,
    @Json(name = "label") val label: String,
    @Json(name = "image_url") val imageUrl: String?,
    @Json(name = "sort_order") val sortOrder: Int
)

/**
 * Request DTOs
 */
data class ProductListRequest(
    @Json(name = "page") val page: Int = 1,
    @Json(name = "page_size") val pageSize: Int = 12,
    @Json(name = "search") val search: String? = null,
    @Json(name = "category") val category: String? = null,
    @Json(name = "featured") val featured: Boolean? = null,
    @Json(name = "shop_id") val shopId: String? = null,
    @Json(name = "sort") val sort: String? = null, // "price_asc", "price_desc", "newest", "rating"
    @Json(name = "min_price") val minPrice: String? = null,
    @Json(name = "max_price") val maxPrice: String? = null
)

data class ProductSearchRequest(
    @Json(name = "q") val query: String,
    @Json(name = "page") val page: Int = 1,
    @Json(name = "page_size") val pageSize: Int = 12,
    @Json(name = "filters") val filters: Map<String, String>? = null
)
