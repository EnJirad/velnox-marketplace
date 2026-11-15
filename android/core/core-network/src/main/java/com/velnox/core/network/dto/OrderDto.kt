package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Order DTOs matching the backend API structure.
 * Based on backend routes: GET /api/orders, POST /api/orders, GET /api/orders/:id
 */

data class OrderListItemDto(
    @Json(name = "id") val id: String,
    @Json(name = "order_number") val orderNumber: String,
    @Json(name = "status") val status: String,
    @Json(name = "total") val total: String,
    @Json(name = "currency") val currency: String = "THB",
    @Json(name = "item_count") val itemCount: Int,
    @Json(name = "shop_count") val shopCount: Int,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class OrderDetailDto(
    @Json(name = "id") val id: String,
    @Json(name = "order_number") val orderNumber: String,
    @Json(name = "status") val status: String,
    @Json(name = "subtotal") val subtotal: String,
    @Json(name = "discount_total") val discountTotal: String,
    @Json(name = "tax_total") val taxTotal: String,
    @Json(name = "shipping_total") val shippingTotal: String,
    @Json(name = "total") val total: String,
    @Json(name = "currency") val currency: String = "THB",
    @Json(name = "payment_method") val paymentMethod: String,
    @Json(name = "payment_status") val paymentStatus: String,
    @Json(name = "shipping_address") val shippingAddress: AddressDto,
    @Json(name = "billing_address") val billingAddress: AddressDto?,
    @Json(name = "groups") val groups: List<OrderGroupDto>,
    @Json(name = "timeline") val timeline: List<OrderTimelineEventDto>,
    @Json(name = "notes") val notes: String?,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class OrderGroupDto(
    @Json(name = "id") val id: String,
    @Json(name = "shop_id") val shopId: String,
    @Json(name = "shop_name") val shopName: String,
    @Json(name = "shop_slug") val shopSlug: String,
    @Json(name = "status") val status: String,
    @Json(name = "subtotal") val subtotal: String,
    @Json(name = "shipping_total") val shippingTotal: String,
    @Json(name = "total") val total: String,
    @Json(name = "shipping_option") val shippingOption: ShippingOptionDto?,
    @Json(name = "tracking_number") val trackingNumber: String?,
    @Json(name = "tracking_carrier") val trackingCarrier: String?,
    @Json(name = "items") val items: List<OrderItemDto>
)

data class OrderItemDto(
    @Json(name = "id") val id: String,
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
    @Json(name = "line_total") val lineTotal: String
)

data class OrderTimelineEventDto(
    @Json(name = "id") val id: String,
    @Json(name = "event_type") val eventType: String,
    @Json(name = "title") val title: String,
    @Json(name = "description") val description: String?,
    @Json(name = "timestamp") val timestamp: String,
    @Json(name = "metadata") val metadata: Map<String, String>?
)

data class CreateOrderRequest(
    @Json(name = "shipping_address_id") val shippingAddressId: String,
    @Json(name = "billing_address_id") val billingAddressId: String? = null,
    @Json(name = "payment_method") val paymentMethod: String, // "stripe", "cod", "promptpay"
    @Json(name = "notes") val notes: String? = null,
    @Json(name = "groups") val groups: List<CreateOrderGroupRequest>
)

data class CreateOrderGroupRequest(
    @Json(name = "shop_id") val shopId: String,
    @Json(name = "shipping_option_id") val shippingOptionId: String,
    @Json(name = "items") val items: List<CreateOrderItemRequest>
)

data class CreateOrderItemRequest(
    @Json(name = "product_id") val productId: String,
    @Json(name = "variant_id") val variantId: String? = null,
    @Json(name = "quantity") val quantity: Int
)

data class CreateOrderResponse(
    @Json(name = "order_id") val orderId: String,
    @Json(name = "order_number") val orderNumber: String,
    @Json(name = "payment_intent_id") val paymentIntentId: String?,
    @Json(name = "client_secret") val clientSecret: String?,
    @Json(name = "redirect_url") val redirectUrl: String?
)

/**
 * Order status constants matching backend
 */
object OrderStatus {
    const val PENDING = "pending"
    const val CONFIRMED = "confirmed"
    const val PROCESSING = "processing"
    const val SHIPPED = "shipped"
    const val DELIVERED = "delivered"
    const val CANCELLED = "cancelled"
    const val REFUNDED = "refunded"
    const val RETURNED = "returned"

    val ALL = listOf(PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED, RETURNED)
    val ACTIVE = listOf(PENDING, CONFIRMED, PROCESSING, SHIPPED)
    val COMPLETED = listOf(DELIVERED)
    val CANCELLED_STATES = listOf(CANCELLED, REFUNDED, RETURNED)
}

/**
 * Payment status constants
 */
object PaymentStatus {
    const val PENDING = "pending"
    const val PROCESSING = "processing"
    const val SUCCEEDED = "succeeded"
    const val FAILED = "failed"
    const val REFUNDED = "refunded"
    const val CANCELLED = "cancelled"

    val ALL = listOf(PENDING, PROCESSING, SUCCEEDED, FAILED, REFUNDED, CANCELLED)
}
