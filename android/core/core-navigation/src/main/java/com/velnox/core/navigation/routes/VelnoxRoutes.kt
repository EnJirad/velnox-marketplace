package com.velnox.core.navigation.routes

import kotlinx.serialization.Serializable

/**
 * Type-safe navigation routes for Velnox Android apps.
 * Uses Kotlin Serialization for argument parsing.
 *
 * Route patterns match the web app routes for consistency.
 */

/**
 * Base route interface
 */
sealed interface Route {
    val routePattern: String
}

/**
 * VelShop (Customer) Routes
 */
object VelShopRoutes {

    @Serializable
    data class Home(
        val category: String? = null,
        val page: Int = 1
    ) : Route {
        override val routePattern = "home"
    }

    @Serializable
    data class Products(
        val category: String? = null,
        val search: String? = null,
        val page: Int = 1,
        val sort: String? = null,
        val minPrice: String? = null,
        val maxPrice: String? = null
    ) : Route {
        override val routePattern = "products"
    }

    @Serializable
    data class ProductDetail(
        val id: String,
        val slug: String? = null
    ) : Route {
        override val routePattern = "product/$id"
    }

    @Serializable
    data class Cart(
        val checkoutGroupId: String? = null
    ) : Route {
        override val routePattern = "cart"
    }

    @Serializable
    data class Checkout(
        val step: String = "address" // address, shipping, payment, review
    ) : Route {
        override val routePattern = "checkout/$step"
    }

    @Serializable
    data class CheckoutSuccess(
        val orderId: String
    ) : Route {
        override val routePattern = "checkout/success/$orderId"
    }

    @Serializable
    data class Orders(
        val status: String? = null,
        val page: Int = 1
    ) : Route {
        override val routePattern = "orders"
    }

    @Serializable
    data class OrderDetail(
        val id: String
    ) : Route {
        override val routePattern = "order/$id"
    }

    @Serializable
    data class Profile() : Route {
        override val routePattern = "profile"
    }

    @Serializable
    data class Addresses() : Route {
        override val routePattern = "addresses"
    }

    @Serializable
    data class AddressForm(
        val addressId: String? = null
    ) : Route {
        override val routePattern = "address/form"
    }

    @Serializable
    data class Wishlist() : Route {
        override val routePattern = "wishlist"
    }

    @Serializable
    data class Notifications() : Route {
        override val routePattern = "notifications"
    }

    @Serializable
    data class Chat(
        val conversationId: String? = null
    ) : Route {
        override val routePattern = "chat"
    }

    @Serializable
    data class Tracking(
        val orderId: String? = null
    ) : Route {
        override val routePattern = "tracking"
    }

    @Serializable
    data class Settings() : Route {
        override val routePattern = "settings"
    }

    @Serializable
    data class Help() : Route {
        override val routePattern = "help"
    }

    @Serializable
    data class ShopDetail(
        val slug: String
    ) : Route {
        override val routePattern = "shop/$slug"
    }

    @Serializable
    data class Category(
        val slug: String
    ) : Route {
        override val routePattern = "category/$slug"
    }

    @Serializable
    data class Search(
        val query: String,
        val page: Int = 1
    ) : Route {
        override val routePattern = "search"
    }
}

/**
 * VelSeller (Seller) Routes
 */
object VelSellerRoutes {

    @Serializable
    data class Dashboard() : Route {
        override val routePattern = "dashboard"
    }

    @Serializable
    data class Onboarding(
        val step: String = "info" // info, business, bank, verification
    ) : Route {
        override val routePattern = "onboarding/$step"
    }

    @Serializable
    data class Shop(
        val tab: String = "overview" // overview, products, orders, settings
    ) : Route {
        override val routePattern = "shop/$tab"
    }

    @Serializable
    data class Products(
        val status: String? = null,
        val page: Int = 1
    ) : Route {
        override val routePattern = "products"
    }

    @Serializable
    data class ProductForm(
        val productId: String? = null
    ) : Route {
        override val routePattern = "product/form"
    }

    @Serializable
    data class Orders(
        val status: String? = null,
        val page: Int = 1
    ) : Route {
        override val routePattern = "orders"
    }

    @Serializable
    data class OrderDetail(
        val id: String
    ) : Route {
        override val routePattern = "order/$id"
    }

    @Serializable
    data class Income(
        val period: String = "month"
    ) : Route {
        override val routePattern = "income"
    }

    @Serializable
    data class IncomeDetail(
        val type: String // gross, commission, payout, returns
    ) : Route {
        override val routePattern = "income/$type"
    }

    @Serializable
    data class Profile() : Route {
        override val routePattern = "profile"
    }

    @Serializable
    data class Chat(
        val conversationId: String? = null
    ) : Route {
        override val routePattern = "chat"
    }

    @Serializable
    data class Goals() : Route {
        override val routePattern = "goals"
    }

    @Serializable
    data class Settings() : Route {
        override val routePattern = "settings"
    }
}

/**
 * Shared routes (auth, etc.)
 */
object SharedRoutes {

    @Serializable
    data class Auth(
        val mode: String = "login" // login, register, forgot-password
    ) : Route {
        override val routePattern = "auth/$mode"
    }

    @Serializable
    data class Onboarding(
        val step: Int = 1
    ) : Route {
        override val routePattern = "onboarding/$step"
    }

    @Serializable
    data class LanguageSelection() : Route {
        override val routePattern = "language"
    }

    @Serializable
    data class DeepLink(
        val path: String
    ) : Route {
        override val routePattern = "deeplink/$path"
    }
}

/**
 * Navigation graph builder helpers
 */
fun String.toRoute(): String = this

/**
 * Route constants for string-based navigation (fallback)
 */
object RouteConstants {
    // VelShop
    const val VELSHOP_HOME = "home"
    const val VELSHOP_PRODUCTS = "products"
    const val VELSHOP_PRODUCT_DETAIL = "product/{id}"
    const val VELSHOP_CART = "cart"
    const val VELSHOP_CHECKOUT = "checkout/{step}"
    const val VELSHOP_CHECKOUT_SUCCESS = "checkout/success/{orderId}"
    const val VELSHOP_ORDERS = "orders"
    const val VELSHOP_ORDER_DETAIL = "order/{id}"
    const val VELSHOP_PROFILE = "profile"
    const val VELSHOP_ADDRESSES = "addresses"
    const val VELSHOP_ADDRESS_FORM = "address/form"
    const val VELSHOP_WISHLIST = "wishlist"
    const val VELSHOP_NOTIFICATIONS = "notifications"
    const val VELSHOP_CHAT = "chat"
    const val VELSHOP_TRACKING = "tracking"
    const val VELSHOP_SETTINGS = "settings"
    const val VELSHOP_HELP = "help"
    const val VELSHOP_SHOP_DETAIL = "shop/{slug}"
    const val VELSHOP_CATEGORY = "category/{slug}"
    const val VELSHOP_SEARCH = "search"

    // VelSeller
    const val VELSELLER_DASHBOARD = "dashboard"
    const val VELSELLER_ONBOARDING = "onboarding/{step}"
    const val VELSELLER_SHOP = "shop/{tab}"
    const val VELSELLER_PRODUCTS = "products"
    const val VELSELLER_PRODUCT_FORM = "product/form"
    const val VELSELLER_ORDERS = "orders"
    const val VELSELLER_ORDER_DETAIL = "order/{id}"
    const val VELSELLER_INCOME = "income"
    const val VELSELLER_INCOME_DETAIL = "income/{type}"
    const val VELSELLER_PROFILE = "profile"
    const val VELSELLER_CHAT = "chat"
    const val VELSELLER_GOALS = "goals"
    const val VELSELLER_SETTINGS = "settings"

    // Shared
    const val AUTH = "auth/{mode}"
    const val ONBOARDING = "onboarding/{step}"
    const val LANGUAGE = "language"
    const val DEEPLINK = "deeplink/{path}"
}
