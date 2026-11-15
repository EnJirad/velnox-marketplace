package com.velnox.velseller

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import com.velnox.core.auth.AuthRepository
import com.velnox.core.designsystem.theme.VelnoxTheme
import com.velnox.core.navigation.graph.VelSellerNavHost
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    private val navController: androidx.navigation.NavHostController by androidx.navigation.compose.rememberNavController()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        setContent {
            VelnoxTheme {
                androidx.compose.foundation.layout.Box(
                    modifier = androidx.compose.ui.Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .navigationBarsPadding()
                ) {
                    VelSellerNavHost(
                        navController = navController,
                        startDestination = com.velnox.core.navigation.routes.RouteConstants.VELSELLER_DASHBOARD,
                        onAuthRequired = { navigateToAuth() }
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
            if (uri.scheme == "com.velnox.velseller" && uri.host == "oauth2redirect") {
                lifecycleScope.launch {
                    authRepository.handleOAuthRedirect(uri).onSuccess { result ->
                        navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSELLER_DASHBOARD) {
                            popUpTo(navController.graph.startDestinationId) { saveState = true }
                            launchSingleTop = true
                        }
                    }.onFailure { error ->
                        navigateToAuth()
                    }
                }
            }
            else if (uri.scheme == "velnox" || uri.host == "seller.velnox.app") {
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
        val path = uri.path ?: ""
        when {
            path.startsWith("/order/") -> {
                val orderId = path.substringAfter("/order/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSELLER_ORDER_DETAIL.replace("{id}", orderId))
            }
            path.startsWith("/product/") -> {
                val productId = path.substringAfter("/product/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSELLER_PRODUCT_FORM.replace("{productId}", productId))
            }
            path.startsWith("/shop/") -> {
                val slug = path.substringAfter("/shop/")
                navController.navigate(com.velnox.core.navigation.routes.RouteConstants.VELSELLER_SHOP.replace("{tab}", "overview"))
            }
        }
    }
}
