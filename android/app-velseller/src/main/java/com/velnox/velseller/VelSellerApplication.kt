package com.velnox.velseller

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate
import com.velnox.core.auth.AuthRepository
import com.velnox.core.common.extensions.ExtensionsKt.launchInViewModel
import com.velnox.core.designsystem.theme.VelnoxTheme
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class VelSellerApplication : Application() {

    private val TAG = "VelSellerApplication"

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate() {
        super.onCreate()

        if (BuildConfig.DEBUG) {
            timber.Timber.plant(timber.Timber.DebugTree())
        } else {
            timber.Timber.plant(CrashReportingTree())
        }

        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)

        launchInViewModel(this) {
            authRepository.getCurrentUser().onSuccess { user ->
                if (user != null) {
                    Log.d(TAG, "Seller session restored: ${user.user?.email}")
                }
            }
        }

        Log.d(TAG, "VelSellerApplication initialized")
    }

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
    }

    private class CrashReportingTree : timber.Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            if (priority == Log.ERROR || priority == Log.WARN) {
                // Send to crash reporting service
            }
        }
    }
}

@dagger.Module
@dagger.hilt.InstallIn(dagger.hilt.components.SingletonComponent::class)
object VelSellerModule {

    @dagger.Provides
    @javax.inject.Singleton
    @dagger.hilt.android.qualifiers.ApplicationContext
    fun provideApiBaseUrl(@dagger.hilt.android.qualifiers.ApplicationContext context: Context): String {
        return context.getString(com.velnox.velseller.BuildConfig.API_BASE_URL)
    }

    @dagger.Provides
    @javax.inject.Singleton
    @dagger.hilt.android.qualifiers.ApplicationContext
    fun provideOAuthRedirectUri(@dagger.hilt.android.qualifiers.ApplicationContext context: Context): String {
        return context.getString(com.velnox.velseller.BuildConfig.OAUTH_REDIRECT_URI)
    }
}
