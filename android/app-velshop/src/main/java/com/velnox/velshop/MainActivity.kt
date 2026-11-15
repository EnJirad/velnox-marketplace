package com.velnox.velshop

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.NavHostController
import androidx.navigation.compose.rememberNavController
import com.velnox.core.auth.AuthRepository
import com.velnox.core.designsystem.theme.VelnoxTheme
import com.velnox.core.navigation.graph.VelShopNavHost
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.EntryPointAccessors
import javax.inject.Inject

/**
 * Main Activity for VelShop app.
 * Entry point for Compose navigation.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    private val navController: NavHostController by rememberNavController()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enable edge-to-edge display
        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            VelnoxTheme {
                // Handle system insets for Compose
                androidx.compose.foundation.layout.Box(
                    modifier = androidx.compose.ui.Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .navigationBarsPadding()
                ) {
                    VelShopNavHost(
                        navController = navController,
                        startDestination = com.velnox.core.navigation.routes.RouteConstants.VELSHOP_HOME,
                        onAuthRequired = { navigateToAuth() },
                        onSellerRequired = { /* not applicable for VelShop */ }
                    )
                }
            }
        }

        // Handle deep links
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        intent?.data?.let { uri ->
            // Handle OAuth redirect
            if (uri.scheme == "com.velnox.velshop" && uri.host == "oauth2redirect") {
                lifecycleScope.launch {
                    authRepository.handleOAuthRedirect(uri).onSuccess { result ->
                        // Exchange code for tokens via backend
                        // Navigate to home on success
                        navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSHOP_HOME) {
                            popUpTo(navController.graph.startDestinationId) { saveState = true }
                            launchSingleTop = true
                        }
                    }.onFailure { error ->
                        // Show error and navigate to login
                        navigateToAuth()
                    }
                }
            }
            // Handle other deep links
            else if (uri.scheme == "velnox" || uri.host == "velnox.app") {
                handleDeepLink(uri)
            }
        }
    }

    private fun navigateToAuth() {
        navController.navigate(com.velnox.core.navigation.routes.RouteConstants.AUTH.replace("{mode}", "login")) {
            popUpTo(navController.graph.startDestinationId) { saveState = true }
            launchSingleTop = true
        }
    }

    private fun handleDeepLink(uri: Uri) {
        // Parse deep link and navigate
        // Example: velnox://product/abc123
        val path = uri.path ?: ""
        when {
            path.startsWith("/product/") -> {
                val productId = path.substringAfter("/product/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSHOP_PRODUCT_DETAIL.replace("{id}", productId))
            }
            path.startsWith("/order/") -> {
                val orderId = path.substringAfter("/order/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSHOP_ORDER_DETAIL.replace("{id}", orderId))
            }
            path.startsWith("/shop/") -> {
                val slug = path.substringAfter("/shop/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSHOP_SHOP_DETAIL.replace("{slug}", slug))
            }
            path.startsWith("/category/") -> {
                val slug = path.substringAfter("/category/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSHOP_CATEGORY.replace("{slug}", slug))
            }
        }
    }
}
