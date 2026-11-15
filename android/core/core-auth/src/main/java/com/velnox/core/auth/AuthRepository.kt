package com.velnox.core.auth

import com.velnox.core.auth.oauth.OAuthManager
import com.velnox.core.auth.token.JwtManager
import com.velnox.core.common.result.Error
import com.velnox.core.common.result.Result
import com.velnox.core.common.result.failure
import com.velnox.core.common.result.success
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import com.velnox.core.datastore.preferences.PreferencesDataStore
import com.velnox.core.network.api.ApiService
import com.velnox.core.network.dto.AuthMeResponse
import com.velnox.core.network.dto.ApiResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Auth Repository - Single source of truth for authentication state.
 * Coordinates between API, token storage, OAuth, and preferences.
 */
@Singleton
class AuthRepository @Inject constructor(
    private val apiService: ApiService,
    private val jwtManager: JwtManager,
    private val oAuthManager: OAuthManager,
    private val preferencesDataStore: PreferencesDataStore,
    private val credentialStorage: KeyStoreCredentialStorage
) {

    private val TAG = "AuthRepository"

    // Auth state
    private var _currentUser: AuthMeResponse? = null
    val currentUser: AuthMeResponse?
        get() = _currentUser

    // Check if user is authenticated
    suspend fun isAuthenticated(): Boolean {
        return withContext(Dispatchers.IO) {
            val hasToken = jwtManager.getAccessToken().getOrNull() != null
            if (!hasToken) return@withContext false

            // Optionally verify with backend
            val isExpired = jwtManager.isTokenExpired()
            !isExpired
        }
    }

    // Get current user from cache or API
    suspend fun getCurrentUser(forceRefresh: Boolean = false): Result<AuthMeResponse?> {
        return withContext(Dispatchers.IO) {
            if (!forceRefresh && _currentUser != null) {
                return@withContext success(_currentUser)
            }

            val response = apiService.getCurrentUser()
            if (response.isSuccessful && response.body()?.isSuccess() == true) {
                val user = response.body()?.getDataOrNull()
                _currentUser = user
                success(user)
            } else if (response.code() == 401) {
                // Session expired, clear tokens
                jwtManager.clearTokens()
                _currentUser = null
                failure(Error.auth("Session expired"))
            } else {
                val error = response.getApiError() ?: Error.server("Failed to get user")
                failure(error)
            }
        }
    }

    // Initiate OAuth flow
    fun launchOAuthFlow(activity: android.app.Activity): Result<Unit> {
        return oAuthManager.launchOAuthFlow(activity)
    }

    // Handle OAuth redirect
    fun handleOAuthRedirect(uri: android.net.Uri): Result<OAuthManager.OAuthResult> {
        return oAuthManager.handleRedirect(uri)
    }

    // Sign out
    suspend fun signOut(): Result<Unit> {
        return withContext(Dispatchers.IO) {
            val logoutResponse = apiService.logout()
            if (!logoutResponse.isSuccessful) {
                Log.w(TAG, "Logout API failed: ${logoutResponse.code()}")
            }

            // Clear local tokens regardless of API response
            jwtManager.clearTokens()
            _currentUser = null

            success(Unit)
        }
    }

    // Refresh user profile
    suspend fun refreshProfile(): Result<AuthMeResponse?> {
        return getCurrentUser(forceRefresh = true)
    }

    // Get stored user role
    suspend fun getUserRole(): Result<String?> {
        return withContext(Dispatchers.IO) {
            val role = credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.USER_ROLE).getOrNull()
            success(role)
        }
    }

    // Check if user is seller
    suspend fun isSeller(): Boolean {
        return withContext(Dispatchers.IO) {
            _currentUser?.seller != null
        }
    }

    // Check if user is admin
    suspend fun isAdmin(): Boolean {
        return withContext(Dispatchers.IO) {
            _currentUser?.user?.role == "admin" || _currentUser?.user?.role == "staff" || _currentUser?.user?.role == "manager"
        }
    }

    // Get user preferences
    suspend fun getLanguage(): Result<String> {
        return preferencesDataStore.getLanguage()
    }

    suspend fun setLanguage(language: String): Result<Unit> {
        return preferencesDataStore.setLanguage(language)
    }

    suspend fun getThemeMode(): Result<String> {
        return preferencesDataStore.getThemeMode()
    }

    suspend fun setThemeMode(mode: String): Result<Unit> {
        return preferencesDataStore.setThemeMode(mode)
    }

    // Check if first launch
    suspend fun isFirstLaunch(): Result<Boolean> {
        return preferencesDataStore.isFirstLaunch()
    }

    suspend fun setFirstLaunchComplete(): Result<Unit> {
        return preferencesDataStore.setFirstLaunchComplete()
    }

    // Check onboarding completion
    suspend fun isOnboardingCompleted(): Result<Boolean> {
        return preferencesDataStore.isOnboardingCompleted()
    }

    suspend fun setOnboardingCompleted(): Result<Unit> {
        return preferencesDataStore.setOnboardingCompleted()
    }

    companion object {
        private const val TAG = "AuthRepository"
    }
}
