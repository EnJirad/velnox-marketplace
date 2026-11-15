package com.velnox.core.network.api

import com.velnox.core.network.dto.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Main API service interface defining all backend endpoints.
 * Matches the Velnox backend API documented in docs/API.md
 */
interface ApiService {

    // ============================================
    // Authentication
    // ============================================

    /**
     * Get current authenticated user.
     * Requires valid session cookie (httpOnly).
     * GET /api/auth/me
     */
    @GET(ApiConstants.AUTH_ME)
    suspend fun getCurrentUser(): Response<ApiResponse<AuthMeResponse>>

    /**
     * Logout - clears session cookie.
     * POST /api/auth/logout
     */
    @POST(ApiConstants.AUTH_LOGOUT)
    suspend fun logout(): Response<ApiResponse<Unit>>

    /**
     * Refresh access token (for native token-based auth if implemented).
     * POST /api/auth/refresh
     */
    @POST("auth/refresh")
    suspend fun refreshToken(@Body request: RefreshTokenRequest): Response<ApiResponse<RefreshTokenResponse>>

    // ============================================
    // Products
    // ============================================

    /**
     * List products with pagination and filters.
     * GET /api/products
     */
    @GET(ApiConstants.PRODUCTS)
    suspend fun listProducts(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 12,
        @Query("search") search: String? = null,
        @Query("category") category: String? = null,
        @Query("featured") featured: Boolean? = null,
        @Query("shop_id") shopId: String? = null,
        @Query("sort") sort: String? = null,
        @Query("min_price") minPrice: String? = null,
        @Query("max_price") maxPrice: String? = null
    ): Response<ApiResponse<PaginatedResponse<ProductListItemDto>>>

    /**
     * Get product by ID.
     * GET /api/products/{id}
     */
    @GET(ApiConstants.PRODUCTS + "/{id}")
    suspend fun getProduct(@Path("id") id: String): Response<ApiResponse<ProductDetailDto>>

    /**
     * Get product by slug.
     * GET /api/products/slug/{slug}
     */
    @GET(ApiConstants.PRODUCTS_SLUG + "/{slug}")
    suspend fun getProductBySlug(@Path("slug") slug: String): Response<ApiResponse<ProductDetailDto>>

    /**
     * Search products.
     * GET /api/products/search
     */
    @GET("products/search")
    suspend fun searchProducts(
        @Query("q") query: String,
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 12,
        @QueryMap filters: Map<String, String>? = null
    ): Response<ApiResponse<PaginatedResponse<ProductListItemDto>>>

    // ============================================
    // Categories
    // ============================================

    /**
     * List all categories (flat or tree).
     * GET /api/categories
     */
    @GET(ApiConstants.CATEGORIES)
    suspend fun listCategories(
        @Query("tree") tree: Boolean = false
    ): Response<ApiResponse<CategoryTreeDto>>

    // ============================================
    // Cart
    // ============================================

    /**
     * Get current user's cart.
     * GET /api/cart
     */
    @GET(ApiConstants.CART)
    suspend fun getCart(): Response<ApiResponse<CartDto>>

    /**
     * Add item to cart.
     * POST /api/cart/items
     */
    @POST(ApiConstants.CART_ITEMS)
    suspend fun addToCart(@Body request: AddToCartRequest): Response<ApiResponse<CartItemResponse>>

    /**
     * Update cart item quantity.
     * PATCH /api/cart/items/{itemId}
     */
    @PATCH(ApiConstants.CART_ITEMS + "/{itemId}")
    suspend fun updateCartItem(
        @Path("itemId") itemId: String,
        @Body request: UpdateCartItemRequest
    ): Response<ApiResponse<CartItemResponse>>

    /**
     * Remove item from cart.
     * DELETE /api/cart/items/{itemId}
     */
    @DELETE(ApiConstants.CART_ITEMS + "/{itemId}")
    suspend fun removeCartItem(@Path("itemId") itemId: String): Response<ApiResponse<Unit>>

    /**
     * Get checkout groups (cart grouped by shop).
     * GET /api/cart/checkout-groups
     */
    @GET("cart/checkout-groups")
    suspend fun getCheckoutGroups(): Response<ApiResponse<List<CheckoutGroupDto>>>

    // ============================================
    // Orders
    // ============================================

    /**
     * List user's orders.
     * GET /api/orders
     */
    @GET(ApiConstants.ORDERS)
    suspend fun listOrders(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 12,
        @Query("status") status: String? = null
    ): Response<ApiResponse<PaginatedResponse<OrderListItemDto>>>

    /**
     * Create new order.
     * POST /api/orders
     */
    @POST(ApiConstants.ORDERS)
    suspend fun createOrder(@Body request: CreateOrderRequest): Response<ApiResponse<CreateOrderResponse>>

    /**
     * Get order by ID.
     * GET /api/orders/{id}
     */
    @GET(ApiConstants.ORDERS + "/{id}")
    suspend fun getOrder(@Path("id") id: String): Response<ApiResponse<OrderDetailDto>>

    // ============================================
    // Addresses
    // ============================================

    /**
     * List user's addresses.
     * GET /api/addresses
     */
    @GET(ApiConstants.ADDRESSES)
    suspend fun listAddresses(): Response<ApiResponse<AddressListDto>>

    /**
     * Create new address.
     * POST /api/addresses
     */
    @POST(ApiConstants.ADDRESSES)
    suspend fun createAddress(@Body request: AddressCreateRequest): Response<ApiResponse<AddressDto>>

    /**
     * Update address.
     * PUT /api/addresses/{id}
     */
    @PUT(ApiConstants.ADDRESSES + "/{id}")
    suspend fun updateAddress(
        @Path("id") id: String,
        @Body request: AddressUpdateRequest
    ): Response<ApiResponse<AddressDto>>

    /**
     * Delete address.
     * DELETE /api/addresses/{id}
     */
    @DELETE(ApiConstants.ADDRESSES + "/{id}")
    suspend fun deleteAddress(@Path("id") id: String): Response<ApiResponse<Unit>>

    // ============================================
    // Shops
    // ============================================

    /**
     * List shops.
     * GET /api/shops
     */
    @GET(ApiConstants.SHOPS)
    suspend fun listShops(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 12,
        @Query("search") search: String? = null
    ): Response<ApiResponse<PaginatedResponse<ShopSummaryDto>>>

    /**
     * Get shop by slug.
     * GET /api/shops/{slug}
     */
    @GET(ApiConstants.SHOPS + "/{slug}")
    suspend fun getShop(@Path("slug") slug: String): Response<ApiResponse<ShopSummaryDto>>

    // ============================================
    // Upload
    // ============================================

    /**
     * Get presigned upload URL for R2.
     * POST /api/upload/presign
     */
    @POST("upload/presign")
    suspend fun getPresignedUrl(
        @Header("Content-Type") contentType: String,
        @Body request: PresignUploadRequest
    ): Response<ApiResponse<PresignUploadResponse>>

    /**
     * Confirm upload completion.
     * POST /api/upload/confirm
     */
    @POST("upload/confirm")
    suspend fun confirmUpload(
        @Body request: ConfirmUploadRequest
    ): Response<ApiResponse<UploadConfirmationResponse>>

    // ============================================
    // Health
    // ============================================

    /**
     * Health check endpoint.
     * GET /health
     */
    @GET(ApiConstants.HEALTH)
    suspend fun healthCheck(): Response<ApiResponse<HealthCheckResponse>>

    // ============================================
    // Seller endpoints (require seller role)
    // ============================================

    /**
     * Get seller onboarding status.
     * GET /api/seller/onboarding
     */
    @GET("seller/onboarding")
    suspend fun getSellerOnboarding(): Response<ApiResponse<SellerOnboardingDto>>

    /**
     * Submit seller onboarding.
     * POST /api/seller/onboarding
     */
    @POST("seller/onboarding")
    suspend fun submitSellerOnboarding(@Body request: SellerOnboardingRequest): Response<ApiResponse<SellerOnboardingDto>>

    /**
     * Get seller shop details.
     * GET /api/seller/shop
     */
    @GET("seller/shop")
    suspend fun getSellerShop(): Response<ApiResponse<SellerShopDto>>

    /**
     * Update seller shop.
     * PUT /api/seller/shop
     */
    @PUT("seller/shop")
    suspend fun updateSellerShop(@Body request: SellerShopUpdateRequest): Response<ApiResponse<SellerShopDto>>

    /**
     * List seller products.
     * GET /api/seller/products
     */
    @GET("seller/products")
    suspend fun listSellerProducts(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 12,
        @Query("status") status: String? = null
    ): Response<ApiResponse<PaginatedResponse<SellerProductListItemDto>>>

    /**
     * Create seller product.
     * POST /api/seller/products
     */
    @POST("seller/products")
    suspend fun createSellerProduct(@Body request: SellerProductCreateRequest): Response<ApiResponse<SellerProductDetailDto>>

    /**
     * Update seller product.
     * PUT /api/seller/products/{id}
     */
    @PUT("seller/products/{id}")
    suspend fun updateSellerProduct(
        @Path("id") id: String,
        @Body request: SellerProductUpdateRequest
    ): Response<ApiResponse<SellerProductDetailDto>>

    /**
     * Delete seller product.
     * DELETE /api/seller/products/{id}
     */
    @DELETE("seller/products/{id}")
    suspend fun deleteSellerProduct(@Path("id") id: String): Response<ApiResponse<Unit>>

    /**
     * List seller orders.
     * GET /api/seller/orders
     */
    @GET("seller/orders")
    suspend fun listSellerOrders(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 12,
        @Query("status") status: String? = null
    ): Response<ApiResponse<PaginatedResponse<SellerOrderListItemDto>>>

    /**
     * Get seller order detail.
     * GET /api/seller/orders/{id}
     */
    @GET("seller/orders/{id}")
    suspend fun getSellerOrder(@Path("id") id: String): Response<ApiResponse<SellerOrderDetailDto>>

    /**
     * Update seller order status.
     * PATCH /api/seller/orders/{id}/status
     */
    @PATCH("seller/orders/{id}/status")
    suspend fun updateSellerOrderStatus(
        @Path("id") id: String,
        @Body request: SellerOrderStatusUpdateRequest
    ): Response<ApiResponse<SellerOrderDetailDto>>

    /**
     * Get seller income summary.
     * GET /api/seller/income
     */
    @GET("seller/income")
    suspend fun getSellerIncome(
        @Query("period") period: String? = null, // "day", "week", "month", "year", "all"
        @Query("start_date") startDate: String? = null,
        @Query("end_date") endDate: String? = null
    ): Response<ApiResponse<SellerIncomeDto>>

    /**
     * Get seller profile.
     * GET /api/seller/profile
     */
    @GET("seller/profile")
    suspend fun getSellerProfile(): Response<ApiResponse<SellerProfileDto>>

    /**
     * Update seller profile.
     * PUT /api/seller/profile
     */
    @PUT("seller/profile")
    suspend fun updateSellerProfile(@Body request: SellerProfileUpdateRequest): Response<ApiResponse<SellerProfileDto>>
}

// ============================================
// Additional Request/Response DTOs for endpoints
// ============================================

data class PresignUploadRequest(
    val filename: String,
    val content_type: String,
    val size: Long
)

data class PresignUploadResponse(
    val upload_url: String,
    val key: String,
    val expires_at: String
)

data class ConfirmUploadRequest(
    val key: String,
    val bucket: String
)

data class UploadConfirmationResponse(
    val url: String,
    val key: String
)

data class HealthCheckResponse(
    val status: String,
    val database: String,
    val timestamp: String
)

data class SellerOnboardingDto(
    val id: String,
    val user_id: String,
    val status: String,
    val shop_name: String?,
    val shop_description: String?,
    val business_type: String?,
    val tax_id: String?,
    val address: String?,
    val phone: String?,
    val bank_account: String?,
    val created_at: String,
    val updated_at: String
)

data class SellerOnboardingRequest(
    val shop_name: String,
    val shop_description: String?,
    val business_type: String,
    val tax_id: String?,
    val address: String,
    val phone: String,
    val bank_account: String
)

data class SellerShopDto(
    val id: String,
    val user_id: String,
    val name: String,
    val slug: String,
    val description: String?,
    val logo_url: String?,
    val cover_url: String?,
    val status: String,
    val is_verified: Boolean,
    val commission_rate: String,
    val rating: Double?,
    val review_count: Int,
    val created_at: String,
    val updated_at: String
)

data class SellerShopUpdateRequest(
    val name: String?,
    val description: String?,
    val logo_url: String?,
    val cover_url: String?,
    val commission_rate: String?
)

data class SellerProductListItemDto(
    val id: String,
    val name: String,
    val slug: String,
    val price: String,
    val stock: Int,
    val status: String,
    val images: List<String>,
    val category_name: String,
    val created_at: String,
    val updated_at: String
)

data class SellerProductDetailDto(
    val id: String,
    val name: String,
    val slug: String,
    val description: String,
    val price: String,
    val original_price: String?,
    val stock: Int,
    val status: String,
    val images: List<String>,
    val category_id: String,
    val category_name: String,
    val variants: List<SellerProductVariantDto>,
    val options: List<SellerProductOptionDto>,
    val created_at: String,
    val updated_at: String
)

data class SellerProductVariantDto(
    val id: String,
    val sku: String,
    val price: String,
    val stock: Int,
    val attributes: Map<String, String>
)

data class SellerProductOptionDto(
    val id: String,
    val name: String,
    val type: String,
    val values: List<SellerProductOptionValueDto>
)

data class SellerProductOptionValueDto(
    val id: String,
    val value: String,
    val label: String,
    val image_url: String?,
    val sort_order: Int
)

data class SellerProductCreateRequest(
    val name: String,
    val description: String,
    val price: String,
    val category_id: String,
    val stock: Int,
    val images: List<String>,
    val variants: List<SellerProductVariantCreateRequest>?,
    val options: List<SellerProductOptionCreateRequest>?
)

data class SellerProductVariantCreateRequest(
    val sku: String,
    val price: String,
    val stock: Int,
    val attributes: Map<String, String>
)

data class SellerProductOptionCreateRequest(
    val name: String,
    val type: String,
    val values: List<SellerProductOptionValueCreateRequest>
)

data class SellerProductOptionValueCreateRequest(
    val value: String,
    val label: String,
    val image_url: String?,
    val sort_order: Int
)

data class SellerProductUpdateRequest(
    val name: String?,
    val description: String?,
    val price: String?,
    val category_id: String?,
    val stock: Int?,
    val status: String?,
    val images: List<String>?,
    val variants: List<SellerProductVariantUpdateRequest>?,
    val options: List<SellerProductOptionUpdateRequest>?
)

data class SellerProductVariantUpdateRequest(
    val id: String?,
    val sku: String?,
    val price: String?,
    val stock: Int?,
    val attributes: Map<String, String>?
)

data class SellerProductOptionUpdateRequest(
    val id: String?,
    val name: String?,
    val type: String?,
    val values: List<SellerProductOptionValueUpdateRequest>?
)

data class SellerProductOptionValueUpdateRequest(
    val id: String?,
    val value: String?,
    val label: String?,
    val image_url: String?,
    val sort_order: Int?
)

data class SellerOrderListItemDto(
    val id: String,
    val order_number: String,
    val status: String,
    val total: String,
    val item_count: Int,
    val created_at: String
)

data class SellerOrderDetailDto(
    val id: String,
    val order_number: String,
    val status: String,
    val subtotal: String,
    val shipping_total: String,
    val total: String,
    val payment_method: String,
    val payment_status: String,
    val shipping_address: AddressDto,
    val items: List<SellerOrderItemDto>,
    val timeline: List<OrderTimelineEventDto>,
    val created_at: String,
    val updated_at: String
)

data class SellerOrderItemDto(
    val id: String,
    val product_id: String,
    val product_name: String,
    val variant_id: String?,
    val quantity: Int,
    val price: String,
    val line_total: String
)

data class SellerOrderStatusUpdateRequest(
    val status: String,
    val tracking_number: String?,
    val tracking_carrier: String?
)

data class SellerIncomeDto(
    val gross_revenue: String,
    val commission_earned: String,
    val net_payout: String,
    val pending_payout: String,
    val period: String,
    val transactions: List<SellerIncomeTransactionDto>
)

data class SellerIncomeTransactionDto(
    val id: String,
    val type: String,
    val amount: String,
    val order_id: String?,
    val description: String,
    val created_at: String
)

data class SellerProfileDto(
    val id: String,
    val user: AuthUserDto,
    val shop: SellerShopDto?,
    val status: String,
    val is_verified: Boolean,
    val commission_rate: String,
    val total_sales: String,
    val total_orders: Int,
    val rating: Double?,
    val created_at: String
)

data class SellerProfileUpdateRequest(
    val phone: String?,
    val bank_account: String?
)
