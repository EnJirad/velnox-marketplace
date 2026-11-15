package com.velnox.core.network.interceptor

import android.util.Log
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import com.velnox.core.network.dto.RefreshTokenRequest
import com.velnox.core.network.dto.RefreshTokenResponse
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import kotlinx.coroutines.runBlocking

/**
 * Authentication interceptor that adds JWT token to requests
 * and handles automatic token refresh on 401 responses.
 */
class AuthInterceptor(
    private val credentialStorage: KeyStoreCredentialStorage
) : Interceptor {

    private val TAG = "AuthInterceptor"
    private val REFRESH_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

    @Suppress("BlockingCoroutine")
    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Check if we have a valid access token
        val accessToken = runBlocking { credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.ACCESS_TOKEN) }
            .getOrNull()

        val requestWithAuth = if (accessToken != null && accessToken.isNotBlank()) {
            originalRequest.newBuilder()
                .header("Authorization", "Bearer $accessToken")
                .build()
        } else {
            originalRequest
        }

        var response = chain.proceed(requestWithAuth)

        // Handle 401 - attempt token refresh
        if (response.code == 401) {
            response.close()
            response = handleTokenRefresh(chain, originalRequest)
        }

        return response
    }

    private fun handleTokenRefresh(chain: Interceptor.Chain, originalRequest: Request): Response {
        val refreshToken = runBlocking { credentialStorage.getString(KeyStoreCredentialStorage.CredentialKeys.REFRESH_TOKEN) }
            .getOrNull()

        if (refreshToken == null || refreshToken.isBlank()) {
            Log.w(TAG, "No refresh token available, returning 401")
            return chain.proceed(originalRequest)
        }

        // Attempt token refresh
        val refreshResponse = try {
            val retrofit = chain.call().request().tag(Retrofit::class.java)?.let { it }
            if (retrofit == null) {
                throw IllegalStateException("Retrofit not found in request tag")
            }

            val apiService = retrofit.create(ApiService::class.java)
            val refreshRequest = RefreshTokenRequest(refreshToken)
            apiService.refreshToken(refreshRequest).execute()
        } catch (e: Exception) {
            Log.e(TAG, "Token refresh failed", e)
            return chain.proceed(originalRequest)
        }

        if (!refreshResponse.isSuccessful || refreshResponse.body()?.isFailure() == true) {
            Log.w(TAG, "Token refresh failed with response: ${refreshResponse.code()}")
            // Clear tokens on refresh failure
            runBlocking { credentialStorage.clearAll() }
            return chain.proceed(originalRequest)
        }

        val newTokens = refreshResponse.body()?.getDataOrNull()
        if (newTokens == null) {
            Log.w(TAG, "Token refresh returned null data")
            return chain.proceed(originalRequest)
        }

        // Store new tokens
        runBlocking {
            credentialStorage.putString(KeyStoreCredentialStorage.CredentialKeys.ACCESS_TOKEN, newTokens.accessToken)
            newTokens.refreshToken?.let {
                credentialStorage.putString(KeyStoreCredentialStorage.CredentialKeys.REFRESH_TOKEN, it)
            }
        }

        // Retry original request with new token
        val newRequest = originalRequest.newBuilder()
            .header("Authorization", "Bearer ${newTokens.accessToken}")
            .build()

        Log.d(TAG, "Token refreshed successfully, retrying request")
        return chain.proceed(newRequest)
    }
}
