package com.velnox.core.auth.oauth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService
import com.velnox.core.common.constants.ApiConstants
import com.velnox.core.common.result.Error
import com.velnox.core.common.result.Result
import com.velnox.core.common.result.failure
import com.velnox.core.common.result.success
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * OAuth Manager for Google Sign-In flow.
 *
 * Current backend uses browser-based OAuth with httpOnly cookies:
 * 1. Frontend redirects to /api/auth/google
 * 2. Backend redirects to Google OAuth consent screen
 * 3. Google redirects back to backend callback
 * 4. Backend sets httpOnly cookie and redirects to frontend
 *
 * For native Android, we need to:
 * - Launch Chrome Custom Tab for OAuth flow
 * - Handle redirect back to app via deep link
 * - Backend must support native redirect URI
 *
 * This class provides the foundation for native OAuth integration.
 */
class OAuthManager(
    private val context: Context,
    private val credentialStorage: KeyStoreCredentialStorage
) {

    private val TAG = "OAuthManager"

    // OAuth configuration - should come from backend config
    private val CLIENT_ID = "your-google-client-id" // TODO: Get from backend config
    private val REDIRECT_URI = "com.velnox.velshop:/oauth2redirect" // Deep link scheme
    private val SCOPES = listOf("openid", "email", "profile")

    // State parameter for CSRF protection
    private val STATE_KEY = "oauth_state"
    private val CODE_VERIFIER_KEY = "oauth_code_verifier"

    /**
     * Initiate Google OAuth flow using Chrome Custom Tabs.
     * Returns the authorization URL to open.
     */
    fun getAuthorizationUrl(): Result<String> {
        return try {
            // Generate PKCE code verifier and challenge
            val codeVerifier = generateCodeVerifier()
            val codeChallenge = generateCodeChallenge(codeVerifier)

            // Generate state for CSRF protection
            val state = generateState()

            // Store state and code verifier for later validation
            withContext(Dispatchers.IO) {
                credentialStorage.putString(STATE_KEY, state)
                credentialStorage.putString(CODE_VERIFIER_KEY, codeVerifier)
            }

            // Build authorization URL
            val authUrl = "https://accounts.google.com/o/oauth2/v2/auth"
                .buildUpon()
                .appendQueryParameter("client_id", CLIENT_ID)
                .appendQueryParameter("redirect_uri", REDIRECT_URI)
                .appendQueryParameter("response_type", "code")
                .appendQueryParameter("scope", SCOPES.joinToString(" "))
                .appendQueryParameter("state", state)
                .appendQueryParameter("code_challenge", codeChallenge)
                .appendQueryParameter("code_challenge_method", "S256")
                .appendQueryParameter("access_type", "offline")
                .appendQueryParameter("prompt", "consent")
                .build()
                .toString()

            success(authUrl)
        } catch (e: Exception) {
            failure(Error.server("Failed to build authorization URL", "OAUTH_URL_FAILED", e))
        }
    }

    /**
     * Launch OAuth flow in Chrome Custom Tab.
     */
    fun launchOAuthFlow(activity: Activity): Result<Unit> {
        return getAuthorizationUrl().flatMap { authUrl ->
            try {
                val customTabsIntent = CustomTabsIntent.Builder()
                    .setToolbarColor(context.getColor(android.R.color.white))
                    .setShowTitle(false)
                    .setStartAnimations(context, android.R.anim.slide_in_left, android.R.anim.slide_out_right)
                    .setExitAnimations(context, android.R.anim.slide_in_right, android.R.anim.slide_out_left)
                    .build()

                customTabsIntent.launchUrl(activity, Uri.parse(authUrl))
                success(Unit)
            } catch (e: Exception) {
                failure(Error.server("Failed to launch OAuth flow", "OAUTH_LAUNCH_FAILED", e))
            }
        }
    }

    /**
     * Handle OAuth redirect from deep link.
     * Call this when app receives the redirect URI.
     */
    fun handleRedirect(uri: Uri): Result<OAuthResult> {
        return try {
            val code = uri.getQueryParameter("code")
            val state = uri.getQueryParameter("state")
            val error = uri.getQueryParameter("error")

            if (error != null) {
                return failure(Error.server("OAuth error: $error", "OAUTH_ERROR"))
            }

            if (code == null) {
                return failure(Error.server("No authorization code in redirect", "OAUTH_NO_CODE"))
            }

            // Verify state parameter
            val storedState = withContext(Dispatchers.IO) {
                credentialStorage.getString(STATE_KEY).getOrNull()
            }

            if (state != storedState) {
                return failure(Error.server("Invalid OAuth state", "OAUTH_INVALID_STATE"))
            }

            // Get code verifier
            val codeVerifier = withContext(Dispatchers.IO) {
                credentialStorage.getString(CODE_VERIFIER_KEY).getOrNull()
            } ?: return failure(Error.server("Missing code verifier", "OAUTH_NO_VERIFIER"))

            // Clear stored state and verifier
            withContext(Dispatchers.IO) {
                credentialStorage.remove(STATE_KEY)
                credentialStorage.remove(CODE_VERIFIER_KEY)
            }

            // Exchange code for tokens via backend
            // Note: Backend currently uses cookie-based sessions
            // For native, backend would need to support token exchange endpoint
            success(OAuthResult(code = code, codeVerifier = codeVerifier))
        } catch (e: Exception) {
            failure(Error.server("Failed to handle OAuth redirect", "OAUTH_REDIRECT_FAILED", e))
        }
    }

    /**
     * Generate PKCE code verifier (43-128 characters)
     */
    private fun generateCodeVerifier(): String {
        val bytes = ByteArray(32)
        java.security.SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            .replace("=", "")
            .replace("+", "-")
            .replace("/", "_")
    }

    /**
     * Generate PKCE code challenge (SHA256 of verifier)
     */
    private fun generateCodeChallenge(codeVerifier: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(codeVerifier.toByteArray())
        return Base64.encodeToString(hash, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            .replace("=", "")
            .replace("+", "-")
            .replace("/", "_")
    }

    /**
     * Generate random state parameter
     */
    private fun generateState(): String {
        val bytes = ByteArray(16)
        java.security.SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            .replace("=", "")
            .replace("+", "-")
            .replace("/", "_")
    }

    /**
     * Check if there's a valid session (cookie-based)
     * This is a placeholder - actual session check would be via API call
     */
    suspend fun hasValidSession(): Boolean {
        return withContext(Dispatchers.IO) {
            val accessToken = credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.ACCESS_TOKEN).getOrNull()
            accessToken != null && accessToken.isNotBlank()
        }
    }

    /**
     * Sign out - clear tokens and cookies
     */
    suspend fun signOut(): Result<Unit> {
        return withContext(Dispatchers.IO) {
            credentialStorage.clearAll()
        }
    }
}

/**
 * OAuth result containing authorization code and verifier
 */
data class OAuthResult(
    val code: String,
    val codeVerifier: String
) {
    /**
     * Exchange code for tokens via backend API.
     * Backend would need to implement /api/auth/google/token endpoint for native.
     */
    fun toTokenRequest(): Map<String, String> = mapOf(
        "code" to code,
        "code_verifier" to codeVerifier,
        "redirect_uri" to "com.velnox.velshop:/oauth2redirect"
    )
}

/**
 * OAuth configuration from backend
 */
data class OAuthConfig(
    val clientId: String,
    val redirectUri: String,
    val scopes: List<String>
)
