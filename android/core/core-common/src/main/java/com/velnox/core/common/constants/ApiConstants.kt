package com.velnox.core.common.constants

/**
 * API endpoint constants shared across the Velnox Android apps.
 * Base URL should be configured via BuildConfig or injection.
 */
object ApiConstants {
    const val BASE_URL_PROD = "https://your-backend.onrender.com/api/"
    const val BASE_URL_DEV = "http://10.0.2.2:3001/api/" // Android emulator localhost

    const val AUTH_GOOGLE = "auth/google"
    const val AUTH_ME = "auth/me"
    const val AUTH_LOGOUT = "auth/logout"

    const val PRODUCTS = "products"
    const val PRODUCTS_SLUG = "products/slug"
    const val CATEGORIES = "categories"
    const val CART = "cart"
    const val CART_ITEMS = "cart/items"
    const val SHOPS = "shops"
    const val ORDERS = "orders"
    const val ADDRESSES = "addresses"
    const val UPLOAD = "upload"
    const val HEALTH = "health"

    // Seller endpoints
    const val SELLER_ONBOARDING = "seller/onboarding"
    const val SELLER_SHOP = "seller/shop"
    const val SELLER_PRODUCTS = "seller/products"
    const val SELLER_ORDERS = "seller/orders"
    const val SELLER_INCOME = "seller/income"
    const val SELLER_PROFILE = "seller/profile"

    // Admin endpoints
    const val ADMIN_USERS = "admin/users"
    const val ADMIN_SELLERS = "admin/sellers"
    const val ADMIN_PRODUCTS = "admin/products"
    const val ADMIN_ORDERS = "admin/orders"
    const val ADMIN_CATEGORIES = "admin/categories"
    const val ADMIN_AUDIT = "admin/audit"
    const val ADMIN_SETTINGS = "admin/settings"
}
