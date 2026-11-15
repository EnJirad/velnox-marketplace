package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Cart DTOs matching the backend API structure.
 * Based on backend routes: GET /api/cart, POST /api/cart/items, PATCH /api/cart/items/:itemId, DELETE /api/cart/items/:itemId
 */

data class CartDto(
    @Json(name = "id") val id: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "items") val items: List<CartItemDto>,
    @Json(name = "subtotal") val subtotal: String,
    @Json(name = "discount_total") val discountTotal: String,
    @Json(name = "tax_total") val taxTotal: String,
    @Json(name = "shipping_total") val shippingTotal: String,
    @Json(name = "total") val total: String,
    @Json(name = "currency") val currency: String = "THB",
    @Json(name = "item_count") val itemCount: Int,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class CartItemDto(
    @Json(name = "id") val id: String,
    @Json(name = "cart_id") val cartId: String,
    @Json(name = "product_id") val productId: String,
    @Json(name = "product_name") val productName: String,
    @Json(name = "product_slug") val productSlug: String,
    @Json(name = "product_image") val productImage: String?,
    @Json(name = "variant_id") val variantId: String?,
    @Json(name = "variant_sku") val variantSku: String?,
    @Json(name = "variant_attributes") val variantAttributes: Map<String, String>?,
    @Json(name = "quantity") val quantity: Int,
    @Json(name = "price") val price: String,
    @Json(name = "original_price") val originalPrice: String?,
    @Json(name = "discount_percent") val discountPercent: Int?,
    @Json(name = "line_total") val lineTotal: String,
    @Json(name = "shop_id") val shopId: String,
    @Json(name = "shop_name") val shopName: String,
    @Json(name = "shop_slug") val shopSlug: String,
    @Json(name = "stock") val stock: Int,
    @Json(name = "added_at") val addedAt: String
)

data class AddToCartRequest(
    @Json(name = "product_id") val productId: String,
    @Json(name = "variant_id") val variantId: String? = null,
    @Json(name = "quantity") val quantity: Int = 1
)

data class UpdateCartItemRequest(
    @Json(name = "quantity") val quantity: Int
)

data class CartItemResponse(
    @Json(name = "item") val item: CartItemDto,
    @Json(name = "cart") val cart: CartDto
)

/**
 * Cart grouping for checkout (multiple shops)
 */
data class CheckoutGroupDto(
    @Json(name = "id") val id: String,
    @Json(name = "shop_id") val shopId: String,
    @Json(name = "shop_name") val shopName: String,
    @Json(name = "shop_slug") val shopSlug: String,
    @Json(name = "items") val items: List<CartItemDto>,
    @Json(name = "subtotal") val subtotal: String,
    @Json(name = "shipping_options") val shippingOptions: List<ShippingOptionDto>
)

data class ShippingOptionDto(
    @Json(name = "id") val id: String,
    @Json(name = "name") val name: String,
    @Json(name = "description") val description: String?,
    @Json(name = "price") val price: String,
    @Json(name = "estimated_days_min") val estimatedDaysMin: Int,
    @Json(name = "estimated_days_max") val estimatedDaysMax: Int,
    @Json(name = "is_cod_available") val isCodAvailable: Boolean
)
