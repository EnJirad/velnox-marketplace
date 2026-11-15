package com.velnox.core.auth.token

import android.util.Base64
import android.util.Log
import com.velnox.core.common.result.Error
import com.velnox.core.common.result.Result
import com.velnox.core.common.result.failure
import com.velnox.core.common.result.success
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * JWT Token Manager
 * Handles JWT parsing, validation, and storage.
 *
 * Backend uses httpOnly cookies for session management.
 * This class handles native token storage if native auth is implemented.
 */
class JwtManager(
    private val credentialStorage: KeyStoreCredentialStorage
) {

    private val TAG = "JwtManager"

    /**
     * JWT Token data class
     */
    data class JwtToken(
        val accessToken: String,
        val refreshToken: String?,
        val expiresIn: Long, // seconds
        val tokenType: String = "Bearer",
        val scope: String? = null
    ) {
        val expiryTimestamp: Long = System.currentTimeMillis() + (expiresIn * 1000)
        val isExpired: Boolean get() = System.currentTimeMillis() >= expiryTimestamp - TimeUnit.MINUTES.toMillis(5) // 5 min buffer
    }

    /**
     * Parse JWT without verification (for reading claims).
     * Note: In production, verify signature with backend public key.
     */
    fun parseJwt(token: String): Result<JwtClaims> {
        return try {
            val parts = token.split(".")
            if (parts.size != 3) {
                return failure(Error.server("Invalid JWT format", "INVALID_JWT_FORMAT"))
            }

            val payload = parts[1]
            val decoded = Base64.decode(payload, Base64.URL_SAFE | Base64.NO_WRAP)
            val json = String(decoded, StandardCharsets.UTF_8)
            val claims = JwtClaims.fromJson(json)
            success(claims)
        } catch (e: Exception) {
            failure(Error.server("Failed to parse JWT", "JWT_PARSE_FAILED", e))
        }
    }

    /**
     * Decode JWT header
     */
    fun decodeHeader(token: String): Result<JwtHeader> {
        return try {
            val parts = token.split(".")
            if (parts.size != 3) {
                return failure(Error.server("Invalid JWT format", "INVALID_JWT_FORMAT"))
            }

            val header = parts[0]
            val decoded = Base64.decode(header, Base64.URL_SAFE | Base64.NO_WRAP)
            val json = String(decoded, StandardCharsets.UTF_8)
            val headerObj = JwtHeader.fromJson(json)
            success(headerObj)
        } catch (e: Exception) {
            failure(Error.server("Failed to decode JWT header", "JWT_HEADER_DECODE_FAILED", e))
        }
    }

    /**
     * Store tokens securely in Keystore
     */
    suspend fun storeTokens(token: JwtToken): Result<Unit> = withContext(Dispatchers.IO) {
        val accessTokenResult = credentialStorage.putString(KeyStoreCredentialStorage.CredentialKeys.ACCESS_TOKEN, token.accessToken)
        if (accessTokenResult.isFailure()) return@withContext accessTokenResult

        if (token.refreshToken != null) {
            val refreshTokenResult = credentialStorage.putString(KeyStoreCredentialStorage.CredentialKeys.REFRESH_TOKEN, token.refreshToken!!)
            if (refreshTokenResult.isFailure()) return@withContext refreshTokenResult
        }

        // Store expiry timestamp
        val expiryResult = credentialStorage.putString(KeyStoreCredentialStorage.CredentialKeys.TOKEN_EXPIRY, token.expiryTimestamp.toString())
        return@withContext expiryResult
    }

    /**
     * Get stored access token
     */
    suspend fun getAccessToken(): Result<String?> = withContext(Dispatchers.IO) {
        credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.ACCESS_TOKEN)
    }

    /**
     * Get stored refresh token
     */
    suspend fun getRefreshToken(): Result<String?> = withContext(Dispatchers.IO) {
        credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.REFRESH_TOKEN)
    }

    /**
     * Check if token is expired or near expiry
     */
    suspend fun isTokenExpired(): Boolean = withContext(Dispatchers.IO) {
        val expiryStr = credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.TOKEN_EXPIRY).getOrNull()
        if (expiryStr == null) return@withContext true

        val expiry = expiryStr.toLongOrNull() ?: 0
        System.currentTimeMillis() >= expiry - TimeUnit.MINUTES.toMillis(5)
    }

    /**
     * Clear all tokens
     */
    suspend fun clearTokens(): Result<Unit> = withContext(Dispatchers.IO) {
        credentialStorage.clearAll()
    }

    /**
     * Get token expiry timestamp
     */
    suspend fun getTokenExpiry(): Result<Long?> = withContext(Dispatchers.IO) {
        val expiryStr = credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.TOKEN_EXPIRY).getOrNull()
        success(expiryStr?.toLongOrNull())
    }
}

/**
 * JWT Claims data class
 */
data class JwtClaims(
    val sub: String?, // Subject (user ID)
    val email: String?,
    val name: String?,
    val role: String?,
    val iat: Long?, // Issued at
    val exp: Long?, // Expiration
    val scope: String?,
    val jti: String? // JWT ID
) {
    companion object {
        fun fromJson(json: String): JwtClaims {
            val obj = JSONObject(json)
            return JwtClaims(
                sub = obj.optString("sub", null),
                email = obj.optString("email", null),
                name = obj.optString("name", null),
                role = obj.optString("role", null),
                iat = obj.optLong("iat", 0).takeIf { it > 0 },
                exp = obj.optLong("exp", 0).takeIf { it > 0 },
                scope = obj.optString("scope", null),
                jti = obj.optString("jti", null)
            )
        }
    }

    val isExpired: Boolean
        get() = exp?.let { it * 1000 < System.currentTimeMillis() } ?: true
}

/**
 * JWT Header data class
 */
data class JwtHeader(
    val alg: String?,
    val typ: String?,
    val kid: String?
) {
    companion object {
        fun fromJson(json: String): JwtHeader {
            val obj = JSONObject(json)
            return JwtHeader(
                alg = obj.optString("alg", null),
                typ = obj.optString("typ", null),
                kid = obj.optString("kid", null)
            )
        }
    }
}
