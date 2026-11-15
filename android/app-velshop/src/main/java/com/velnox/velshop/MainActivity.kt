package com.velnox.velshop

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enable edge-to-edge display
        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            val navController = rememberNavController()
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
                        onAuthRequired = { navigateToAuth(navController) },
                        onSellerRequired = { /* not applicable for VelShop */ }
                    )
                }
            }
        }

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
                        // Note: navController not accessible here directly, would need to use a shared state
                    }.onFailure { error ->
                        // Show error and navigate to login
                    }
                }
            }
            // Handle other deep links
            else if (uri.scheme == "velnox" || uri.host == "velnox.app") {
                handleDeepLink(uri)
            }
        }
    }

    private fun navigateToAuth(navController: NavHostController) {
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
                // Would need navController here - use shared state or navigation from Compose
            }
            path.startsWith("/order/") -> {
                val orderId = path.substringAfter("/order/")
            }
            path.startsWith("/shop/") -> {
                val slug = path.substringAfter("/shop/")
            }
            path.startsWith("/category/") -> {
                val slug = path.substringAfter("/category/")
            }
        }
    }
}
