package com.velnox.core.network.interceptor

import com.velnox.core.common.result.Error
import com.velnox.core.network.dto.ApiError
import com.velnox.core.network.dto.ApiResponse
import okhttp3.Interceptor
import okhttp3.Response
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.runBlocking

/**
 * Error handling interceptor that converts HTTP errors to standardized ApiError objects.
 */
class ErrorInterceptor : Interceptor {

    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val apiErrorAdapter = moshi.adapter(ApiError::class.java)

    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())

        // Only process error responses
        if (!response.isSuccessful) {
            val error = parseErrorResponse(response)
            // Attach error to response for downstream handling
            return response.newBuilder()
                .tag(ErrorInterceptor::class.java, error)
                .build()
        }

        return response
    }

    private fun parseErrorResponse(response: Response): ApiError {
        return try {
            val responseBody = response.body?.string() ?: ""
            if (responseBody.isNotBlank()) {
                val apiResponse = moshi.adapter(ApiResponse<Any>::class.java).fromJson(responseBody)
                apiResponse?.getErrorOrNull() ?: ApiError.server("HTTP ${response.code}")
            } else {
                ApiError.server("HTTP ${response.code}: ${response.message}")
            }
        } catch (e: Exception) {
            ApiError.server("HTTP ${response.code}: ${response.message}", throwable = e)
        }
    }

    /**
     * Extension to retrieve the parsed error from a response.
     */
    companion object {
        fun Response.getApiError(): ApiError? {
            return this.tag(ErrorInterceptor::class.java) as? ApiError
        }
    }
}
