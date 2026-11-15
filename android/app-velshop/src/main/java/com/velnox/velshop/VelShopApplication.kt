package com.velnox.velshop

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate
import com.velnox.core.auth.AuthRepository
import com.velnox.core.common.extensions.ExtensionsKt.launchInViewModel
import com.velnox.core.designsystem.theme.VelnoxTheme
import com.velnox.core.network.NetworkModule
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * VelShop Application Class
 * Hilt entry point for dependency injection.
 */
@HiltAndroidApp
class VelShopApplication : Application() {

    private val TAG = "VelShopApplication"

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate() {
        super.onCreate()

        // Initialize Timber for logging
        if (BuildConfig.DEBUG) {
            timber.Timber.plant(timber.Timber.DebugTree())
        } else {
            timber.Timber.plant(CrashReportingTree())
        }

        // Force light theme for now (dark theme support can be added later)
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)

        // Initialize auth state
        launchInViewModel(this) {
            authRepository.getCurrentUser().onSuccess { user ->
                if (user != null) {
                    Log.d(TAG, "User session restored: ${user.user?.email}")
                }
            }
        }

        Log.d(TAG, "VelShopApplication initialized")
    }

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        // MultiDex.install(this) if needed
    }

    /**
     * Custom Timber tree for crash reporting integration.
     * Replace with actual crash reporting service (Firebase Crashlytics, Sentry, etc.)
     */
    private class CrashReportingTree : timber.Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            if (priority == Log.ERROR || priority == Log.WARN) {
                // Send to crash reporting service
                // Crashlytics.log(message)
                // Crashlytics.recordException(t ?: Exception(message))
            }
        }
    }
}

/**
 * Hilt module for VelShop-specific bindings.
 * This can be used to override core module bindings or add app-specific ones.
 */
@dagger.Module
@dagger.hilt.InstallIn(dagger.hilt.components.SingletonComponent::class)
object VelShopModule {

    // Override base URL for this app
    @dagger.Provides
    @javax.inject.Singleton
    @dagger.hilt.android.qualifiers.ApplicationContext
    fun provideApiBaseUrl(@dagger.hilt.android.qualifiers.ApplicationContext context: Context): String {
        return context.getString(com.velnox.velshop.BuildConfig.API_BASE_URL)
    }

    // Provide OAuth redirect URI
    @dagger.Provides
    @javax.inject.Singleton
    @dagger.hilt.android.qualifiers.ApplicationContext
    fun provideOAuthRedirectUri(@dagger.hilt.android.qualifiers.ApplicationContext context: Context): String {
        return context.getString(com.velnox.velshop.BuildConfig.OAUTH_REDIRECT_URI)
    }
}
