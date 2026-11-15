package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Standard API response wrapper matching the backend format.
 * Backend returns: { "success": true, "data": {...} } or { "success": false, "error": {...} }
 */
sealed class ApiResponse<out T> {
    @Json(name = "success")
    abstract val success: Boolean

    data class Success<T>(
        @Json(name = "data") val data: T,
        override val success: Boolean = true
    ) : ApiResponse<T>()

    data class Failure(
        @Json(name = "error") val error: ApiError,
        override val success: Boolean = false
    ) : ApiResponse<Nothing>()

    companion object {
        fun <T> success(data: T): ApiResponse<T> = Success(data)
        fun <T> failure(error: ApiError): ApiResponse<T> = Failure(error)
    }

    fun isSuccess(): Boolean = this is Success
    fun isFailure(): Boolean = this is Failure

    fun getDataOrNull(): T? = when (this) {
        is Success -> data
        is Failure -> null
    }

    fun getErrorOrNull(): ApiError? = when (this) {
        is Success -> null
        is Failure -> error
    }
}

/**
 * API error structure matching backend format.
 */
data class ApiError(
    @Json(name = "code") val code: String,
    @Json(name = "message") val message: String
) {
    companion object {
        fun unknown(message: String = "Unknown error"): ApiError = ApiError("UNKNOWN", message)
        fun network(message: String = "Network error"): ApiError = ApiError("NETWORK_ERROR", message)
        fun unauthorized(message: String = "Authentication required"): ApiError = ApiError("UNAUTHORIZED", message)
        fun forbidden(message: String = "Access denied"): ApiError = ApiError("FORBIDDEN", message)
        fun notFound(message: String = "Resource not found"): ApiError = ApiError("NOT_FOUND", message)
        fun validation(message: String = "Validation failed"): ApiError = ApiError("VALIDATION_ERROR", message)
        fun server(message: String = "Server error"): ApiError = ApiError("INTERNAL_ERROR", message)
    }
}

/**
 * Paginated response wrapper.
 */
data class PaginatedResponse<T>(
    @Json(name = "data") val data: List<T>,
    @Json(name = "page") val page: Int,
    @Json(name = "pageSize") val pageSize: Int,
    @Json(name = "total") val total: Long,
    @Json(name = "totalPages") val totalPages: Int
) {
    val hasNextPage: Boolean = page < totalPages
    val hasPreviousPage: Boolean = page > 1
}
