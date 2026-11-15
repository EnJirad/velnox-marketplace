package com.velnox.core.navigation.graph

import androidx.compose.runtime.Composable
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import com.velnox.core.navigation.routes.RouteConstants
import com.velnox.core.navigation.routes.VelShopRoutes
import com.velnox.core.navigation.routes.VelSellerRoutes
import com.velnox.core.navigation.routes.SharedRoutes

/**
 * Navigation graph builders for Velnox apps.
 * Each app has its own graph with type-safe routes.
 */

@Composable
fun VelShopNavHost(
    navController: androidx.navigation.NavHostController,
    startDestination: String = RouteConstants.VELSHOP_HOME,
    onAuthRequired: () -> Unit = {},
    onSellerRequired: () -> Unit = {}
) {
    NavHost(navController, startDestination) {
        // Home & Discovery
        composable(RouteConstants.VELSHOP_HOME) {
            VelShopScreen.Home(onCategoryClick = { slug ->
                navController.navigate(RouteConstants.VELSHOP_CATEGORY.replace("{slug}", slug))
            })
        }

        composable(
            route = RouteConstants.VELSHOP_PRODUCTS,
            arguments = listOf(
                androidx.navigation.navArgument("category") { type = androidx.navigation.NavType.StringType; nullable = true },
                androidx.navigation.navArgument("search") { type = androidx.navigation.NavType.StringType; nullable = true },
                androidx.navigation.navArgument("page") { type = androidx.navigation.NavType.IntType; nullable = true },
                androidx.navigation.navArgument("sort") { type = androidx.navigation.NavType.StringType; nullable = true }
            )
        ) { backStackEntry ->
            val category = backStackEntry.getString()?.getString("category")
            val search = backStackEntry.getString()?.getString("search")
            val page = backStackEntry.getInt("page", 1)
            val sort = backStackEntry.getString()?.getString("sort")
            VelShopScreen.Products(
                category = category,
                search = search,
                page = page,
                sort = sort,
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSHOP_PRODUCT_DETAIL.replace("{id}", id))
                }
            )
        }

        composable(
            route = RouteConstants.VELSHOP_PRODUCT_DETAIL,
            arguments = listOf(androidx.navigation.navArgument("id") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val productId = backStackEntry.getString()?.getString("id") ?: ""
            VelShopScreen.ProductDetail(
                productId = productId,
                onAddToCart = { /* handled in screen */ },
                onBuyNow = { /* handled in screen */ }
            )
        }

        composable(
            route = RouteConstants.VELSHOP_CATEGORY,
            arguments = listOf(androidx.navigation.navArgument("slug") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val slug = backStackEntry.getString()?.getString("slug") ?: ""
            VelShopScreen.Category(
                categorySlug = slug,
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSHOP_PRODUCT_DETAIL.replace("{id}", id))
                }
            )
        }

        composable(
            route = RouteConstants.VELSHOP_SEARCH,
            arguments = listOf(
                androidx.navigation.navArgument("query") { type = androidx.navigation.NavType.StringType },
                androidx.navigation.navArgument("page") { type = androidx.navigation.NavType.IntType; nullable = true }
            )
        ) { backStackEntry ->
            val query = backStackEntry.getString()?.getString("query") ?: ""
            val page = backStackEntry.getInt("page", 1)
            VelShopScreen.Search(
                query = query,
                page = page,
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSHOP_PRODUCT_DETAIL.replace("{id}", id))
                }
            )
        }

        // Cart & Checkout
        composable(RouteConstants.VELSHOP_CART) {
            VelShopScreen.Cart(
                onCheckoutClick = {
                    // Check auth before checkout
                    if (/* auth check */ false) {
                        navController.navigate(RouteConstants.VELSHOP_CHECKOUT.replace("{step}", "address"))
                    } else {
                        onAuthRequired()
                    }
                }
            )
        }

        navigation(
            startDestination = RouteConstants.VELSHOP_CHECKOUT.replace("{step}", "address"),
            route = RouteConstants.VELSHOP_CHECKOUT
        ) {
            composable(
                route = RouteConstants.VELSHOP_CHECKOUT,
                arguments = listOf(androidx.navigation.navArgument("step") { type = androidx.navigation.NavType.StringType })
            ) { backStackEntry ->
                val step = backStackEntry.getString()?.getString("step") ?: "address"
                VelShopScreen.Checkout(
                    currentStep = step,
                    onStepComplete = { nextStep ->
                        navController.navigate(RouteConstants.VELSHOP_CHECKOUT.replace("{step}", nextStep))
                    },
                    onComplete = { orderId ->
                        navController.navigate(RouteConstants.VELSHOP_CHECKOUT_SUCCESS.replace("{orderId}", orderId))
                        navController.popBackStack(RouteConstants.VELSHOP_HOME, inclusive = false)
                    }
                )
            }
        }

        composable(
            route = RouteConstants.VELSHOP_CHECKOUT_SUCCESS,
            arguments = listOf(androidx.navigation.navArgument("orderId") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val orderId = backStackEntry.getString()?.getString("orderId") ?: ""
            VelShopScreen.CheckoutSuccess(orderId = orderId)
        }

        // Orders
        composable(
            route = RouteConstants.VELSHOP_ORDERS,
            arguments = listOf(
                androidx.navigation.navArgument("status") { type = androidx.navigation.NavType.StringType; nullable = true },
                androidx.navigation.navArgument("page") { type = androidx.navigation.NavType.IntType; nullable = true }
            )
        ) { backStackEntry ->
            val status = backStackEntry.getString()?.getString("status")
            val page = backStackEntry.getInt("page", 1)
            VelShopScreen.Orders(
                status = status,
                page = page,
                onOrderClick = { id ->
                    navController.navigate(RouteConstants.VELSHOP_ORDER_DETAIL.replace("{id}", id))
                }
            )
        }

        composable(
            route = RouteConstants.VELSHOP_ORDER_DETAIL,
            arguments = listOf(androidx.navigation.navArgument("id") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val orderId = backStackEntry.getString()?.getString("id") ?: ""
            VelShopScreen.OrderDetail(
                orderId = orderId,
                onTrackClick = {
                    navController.navigate(RouteConstants.VELSHOP_TRACKING)
                }
            )
        }

        // Profile & Settings
        composable(RouteConstants.VELSHOP_PROFILE) {
            VelShopScreen.Profile(
                onAddressClick = {
                    navController.navigate(RouteConstants.VELSHOP_ADDRESSES)
                },
                onWishlistClick = {
                    navController.navigate(RouteConstants.VELSHOP_WISHLIST)
                },
                onSettingsClick = {
                    navController.navigate(RouteConstants.VELSHOP_SETTINGS)
                }
            )
        }

        composable(RouteConstants.VELSHOP_ADDRESSES) {
            VelShopScreen.Addresses(
                onAddClick = {
                    navController.navigate(RouteConstants.VELSHOP_ADDRESS_FORM)
                },
                onEditClick = { addressId ->
                    navController.navigate(RouteConstants.VELSHOP_ADDRESS_FORM.replace("{addressId}", addressId))
                }
            )
        }

        composable(
            route = RouteConstants.VELSHOP_ADDRESS_FORM,
            arguments = listOf(androidx.navigation.navArgument("addressId") { type = androidx.navigation.NavType.StringType; nullable = true })
        ) { backStackEntry ->
            val addressId = backStackEntry.getString()?.getString("addressId")
            VelShopScreen.AddressForm(
                addressId = addressId,
                onSave = {
                    navController.popBackStack()
                }
            )
        }

        composable(RouteConstants.VELSHOP_WISHLIST) {
            VelShopScreen.Wishlist(
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSHOP_PRODUCT_DETAIL.replace("{id}", id))
                }
            )
        }

        composable(RouteConstants.VELSHOP_NOTIFICATIONS) {
            VelShopScreen.Notifications()
        }

        composable(RouteConstants.VELSHOP_CHAT) {
            VelShopScreen.Chat()
        }

        composable(RouteConstants.VELSHOP_TRACKING) {
            VelShopScreen.Tracking()
        }

        composable(RouteConstants.VELSHOP_SETTINGS) {
            VelShopScreen.Settings(
                onLanguageClick = {
                    navController.navigate(RouteConstants.LANGUAGE)
                },
                onLogoutClick = { /* handled in screen */ }
            )
        }

        composable(RouteConstants.VELSHOP_HELP) {
            VelShopScreen.Help()
        }

        composable(
            route = RouteConstants.VELSHOP_SHOP_DETAIL,
            arguments = listOf(androidx.navigation.navArgument("slug") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val slug = backStackEntry.getString()?.getString("slug") ?: ""
            VelShopScreen.ShopDetail(
                shopSlug = slug,
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSHOP_PRODUCT_DETAIL.replace("{id}", id))
                }
            )
        }

        // Auth & Onboarding (shared)
        navigation(
            startDestination = RouteConstants.AUTH.replace("{mode}", "login"),
            route = RouteConstants.AUTH
        ) {
            composable(
                route = RouteConstants.AUTH,
                arguments = listOf(androidx.navigation.navArgument("mode") { type = androidx.navigation.NavType.StringType })
            ) { backStackEntry ->
                val mode = backStackEntry.getString()?.getString("mode") ?: "login"
                SharedScreen.Auth(
                    mode = mode,
                    onAuthSuccess = {
                        navController.popBackStack(RouteConstants.VELSHOP_HOME, inclusive = false)
                    }
                )
            }
        }

        composable(RouteConstants.LANGUAGE) {
            SharedScreen.LanguageSelection(
                onSelected = {
                    navController.popBackStack()
                }
            )
        }

        // Deep link handling
        composable(
            route = RouteConstants.DEEPLINK,
            arguments = listOf(androidx.navigation.navArgument("path") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val path = backStackEntry.getString()?.getString("path") ?: ""
            handleDeepLink(path, navController)
        }
    }
}

@Composable
fun VelSellerNavHost(
    navController: androidx.navigation.NavHostController,
    startDestination: String = RouteConstants.VELSELLER_DASHBOARD,
    onAuthRequired: () -> Unit = {}
) {
    NavHost(navController, startDestination) {
        // Dashboard
        composable(RouteConstants.VELSELLER_DASHBOARD) {
            VelSellerScreen.Dashboard(
                onOrderClick = { id ->
                    navController.navigate(RouteConstants.VELSELLER_ORDER_DETAIL.replace("{id}", id))
                },
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSELLER_PRODUCT_FORM.replace("{productId}", id))
                }
            )
        }

        // Onboarding
        navigation(
            startDestination = RouteConstants.VELSELLER_ONBOARDING.replace("{step}", "info"),
            route = RouteConstants.VELSELLER_ONBOARDING
        ) {
            composable(
                route = RouteConstants.VELSELLER_ONBOARDING,
                arguments = listOf(androidx.navigation.navArgument("step") { type = androidx.navigation.NavType.StringType })
            ) { backStackEntry ->
                val step = backStackEntry.getString()?.getString("step") ?: "info"
                VelSellerScreen.Onboarding(
                    currentStep = step,
                    onNext = { nextStep ->
                        navController.navigate(RouteConstants.VELSELLER_ONBOARDING.replace("{step}", nextStep))
                    },
                    onComplete = {
                        navController.popBackStack(RouteConstants.VELSELLER_DASHBOARD, inclusive = false)
                    }
                )
            }
        }

        // Shop management
        navigation(
            startDestination = RouteConstants.VELSELLER_SHOP.replace("{tab}", "overview"),
            route = RouteConstants.VELSELLER_SHOP
        ) {
            composable(
                route = RouteConstants.VELSELLER_SHOP,
                arguments = listOf(androidx.navigation.navArgument("tab") { type = androidx.navigation.NavType.StringType })
            ) { backStackEntry ->
                val tab = backStackEntry.getString()?.getString("tab") ?: "overview"
                VelSellerScreen.Shop(
                    currentTab = tab,
                    onProductClick = { id ->
                        navController.navigate(RouteConstants.VELSELLER_PRODUCT_FORM.replace("{productId}", id))
                    },
                    onOrderClick = { id ->
                        navController.navigate(RouteConstants.VELSELLER_ORDER_DETAIL.replace("{id}", id))
                    }
                )
            }
        }

        // Products
        composable(
            route = RouteConstants.VELSELLER_PRODUCTS,
            arguments = listOf(
                androidx.navigation.navArgument("status") { type = androidx.navigation.NavType.StringType; nullable = true },
                androidx.navigation.navArgument("page") { type = androidx.navigation.NavType.IntType; nullable = true }
            )
        ) { backStackEntry ->
            val status = backStackEntry.getString()?.getString("status")
            val page = backStackEntry.getInt("page", 1)
            VelSellerScreen.Products(
                status = status,
                page = page,
                onProductClick = { id ->
                    navController.navigate(RouteConstants.VELSELLER_PRODUCT_FORM.replace("{productId}", id))
                },
                onAddClick = {
                    navController.navigate(RouteConstants.VELSELLER_PRODUCT_FORM)
                }
            )
        }

        composable(
            route = RouteConstants.VELSELLER_PRODUCT_FORM,
            arguments = listOf(androidx.navigation.navArgument("productId") { type = androidx.navigation.NavType.StringType; nullable = true })
        ) { backStackEntry ->
            val productId = backStackEntry.getString()?.getString("productId")
            VelSellerScreen.ProductForm(
                productId = productId,
                onSave = {
                    navController.popBackStack()
                }
            )
        }

        // Orders
        composable(
            route = RouteConstants.VELSELLER_ORDERS,
            arguments = listOf(
                androidx.navigation.navArgument("status") { type = androidx.navigation.NavType.StringType; nullable = true },
                androidx.navigation.navArgument("page") { type = androidx.navigation.NavType.IntType; nullable = true }
            )
        ) { backStackEntry ->
            val status = backStackEntry.getString()?.getString("status")
            val page = backStackEntry.getInt("page", 1)
            VelSellerScreen.Orders(
                status = status,
                page = page,
                onOrderClick = { id ->
                    navController.navigate(RouteConstants.VELSELLER_ORDER_DETAIL.replace("{id}", id))
                }
            )
        }

        composable(
            route = RouteConstants.VELSELLER_ORDER_DETAIL,
            arguments = listOf(androidx.navigation.navArgument("id") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val orderId = backStackEntry.getString()?.getString("id") ?: ""
            VelSellerScreen.OrderDetail(
                orderId = orderId,
                onStatusUpdate = { /* handled in screen */ }
            )
        }

        // Income
        composable(RouteConstants.VELSELLER_INCOME) {
            VelSellerScreen.Income(
                onDetailClick = { type ->
                    navController.navigate(RouteConstants.VELSELLER_INCOME_DETAIL.replace("{type}", type))
                }
            )
        }

        composable(
            route = RouteConstants.VELSELLER_INCOME_DETAIL,
            arguments = listOf(androidx.navigation.navArgument("type") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry =>
            val type = backStackEntry.getString()?.getString("type") ?: "gross"
            VelSellerScreen.IncomeDetail(incomeType = type)
        }

        // Profile & Settings
        composable(RouteConstants.VELSELLER_PROFILE) {
            VelSellerScreen.Profile(
                onSettingsClick = {
                    navController.navigate(RouteConstants.VELSELLER_SETTINGS)
                }
            )
        }

        composable(RouteConstants.VELSELLER_CHAT) {
            VelSellerScreen.Chat()
        }

        composable(RouteConstants.VELSELLER_GOALS) {
            VelSellerScreen.Goals()
        }

        composable(RouteConstants.VELSELLER_SETTINGS) {
            VelSellerScreen.Settings(
                onLanguageClick = {
                    navController.navigate(RouteConstants.LANGUAGE)
                },
                onLogoutClick = { /* handled in screen */ }
            )
        }

        // Shared Auth & Onboarding
        navigation(
            startDestination = RouteConstants.AUTH.replace("{mode}", "login"),
            route = RouteConstants.AUTH
        ) {
            composable(
                route = RouteConstants.AUTH,
                arguments = listOf(androidx.navigation.navArgument("mode") { type = androidx.navigation.NavType.StringType })
            ) { backStackEntry ->
                val mode = backStackEntry.getString()?.getString("mode") ?: "login"
                SharedScreen.Auth(
                    mode = mode,
                    onAuthSuccess = {
                        navController.popBackStack(RouteConstants.VELSELLER_DASHBOARD, inclusive = false)
                    }
                )
            }
        }

        composable(RouteConstants.LANGUAGE) {
            SharedScreen.LanguageSelection(
                onSelected = {
                    navController.popBackStack()
                }
            )
        }

        // Deep link handling
        composable(
            route = RouteConstants.DEEPLINK,
            arguments = listOf(androidx.navigation.navArgument("path") { type = androidx.navigation.NavType.StringType })
        ) { backStackEntry ->
            val path = backStackEntry.getString()?.getString("path") ?: ""
            handleDeepLink(path, navController)
        }
    }
}

/**
 * Screen placeholders - actual implementations in app modules
 */
object VelShopScreen {
    @Composable
    fun Home(onCategoryClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Products(category: String?, search: String?, page: Int, sort: String?, onProductClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun ProductDetail(productId: String, onAddToCart: () -> Unit, onBuyNow: () -> Unit) { /* TODO */ }
    @Composable
    fun Category(categorySlug: String, onProductClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Search(query: String, page: Int, onProductClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Cart(onCheckoutClick: () -> Unit) { /* TODO */ }
    @Composable
    fun Checkout(currentStep: String, onStepComplete: (String) -> Unit, onComplete: (String) -> Unit) { /* TODO */ }
    @Composable
    fun CheckoutSuccess(orderId: String) { /* TODO */ }
    @Composable
    fun Orders(status: String?, page: Int, onOrderClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun OrderDetail(orderId: String, onTrackClick: () -> Unit) { /* TODO */ }
    @Composable
    fun Profile(onAddressClick: () -> Unit, onWishlistClick: () -> Unit, onSettingsClick: () -> Unit) { /* TODO */ }
    @Composable
    fun Addresses(onAddClick: () -> Unit, onEditClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun AddressForm(addressId: String?, onSave: () -> Unit) { /* TODO */ }
    @Composable
    fun Wishlist(onProductClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Notifications() { /* TODO */ }
    @Composable
    fun Chat() { /* TODO */ }
    @Composable
    fun Tracking() { /* TODO */ }
    @Composable
    fun Settings(onLanguageClick: () -> Unit, onLogoutClick: () -> Unit) { /* TODO */ }
    @Composable
    fun Help() { /* TODO */ }
    @Composable
    fun ShopDetail(shopSlug: String, onProductClick: (String) -> Unit) { /* TODO */ }
}

object VelSellerScreen {
    @Composable
    fun Dashboard(onOrderClick: (String) -> Unit, onProductClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Onboarding(currentStep: String, onNext: (String) -> Unit, onComplete: () -> Unit) { /* TODO */ }
    @Composable
    fun Shop(currentTab: String, onProductClick: (String) -> Unit, onOrderClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Products(status: String?, page: Int, onProductClick: (String) -> Unit, onAddClick: () -> Unit) { /* TODO */ }
    @Composable
    fun ProductForm(productId: String?, onSave: () -> Unit) { /* TODO */ }
    @Composable
    fun Orders(status: String?, page: Int, onOrderClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun OrderDetail(orderId: String, onStatusUpdate: (String) -> Unit) { /* TODO */ }
    @Composable
    fun Income(onDetailClick: (String) -> Unit) { /* TODO */ }
    @Composable
    fun IncomeDetail(incomeType: String) { /* TODO */ }
    @Composable
    fun Profile(onSettingsClick: () -> Unit) { /* TODO */ }
    @Composable
    fun Chat() { /* TODO */ }
    @Composable
    fun Goals() { /* TODO */ }
    @Composable
    fun Settings(onLanguageClick: () -> Unit, onLogoutClick: () -> Unit) { /* TODO */ }
}

object SharedScreen {
    @Composable
    fun Auth(mode: String, onAuthSuccess: () -> Unit) { /* TODO */ }
    @Composable
    fun LanguageSelection(onSelected: () -> Unit) { /* TODO */ }
}

/**
 * Handle deep links for both apps
 */
fun handleDeepLink(path: String, navController: androidx.navigation.NavHostController) {
    // Parse deep link path and navigate accordingly
    // Example: /product/abc123 -> navigate to product detail
    // Example: /order/xyz789 -> navigate to order detail
    // Example: /shop/shop-slug -> navigate to shop detail
}
