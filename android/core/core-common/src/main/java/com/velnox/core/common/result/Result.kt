package com.velnox.core.common.result

/**
 * A sealed class representing the result of an operation that can succeed or fail.
 * Used throughout the app for consistent error handling without exceptions.
 */
sealed class Result<out T> {
    data class Success<out T>(val data: T) : Result<T>()
    data class Failure(val error: Error) : Result<Nothing>()

    companion object {
        fun <T> success(data: T): Result<T> = Success(data)
        fun <T> failure(error: Error): Result<T> = Failure(error)
        fun <T> failure(message: String, code: String = "UNKNOWN", throwable: Throwable? = null): Result<T> =
            Failure(Error(message, code, throwable))
    }

    fun isSuccess(): Boolean = this is Success
    fun isFailure(): Boolean = this is Failure

    fun getOrNull(): T? = when (this) {
        is Success -> data
        is Failure -> null
    }

    fun getOrThrow(): T = when (this) {
        is Success -> data
        is Failure -> throw error.throwable ?: IllegalStateException(error.message)
    }

    fun <R> map(transform: (T) -> R): Result<R> = when (this) {
        is Success -> Success(transform(data))
        is Failure -> this
    }

    fun <R> flatMap(transform: (T) -> Result<R>): Result<R> = when (this) {
        is Success -> transform(data)
        is Failure -> this
    }

    fun onSuccess(action: (T) -> Unit): Result<T> = when (this) {
        is Success -> {
            action(data)
            this
        }
        is Failure -> this
    }

    fun onFailure(action: (Error) -> Unit): Result<T> = when (this) {
        is Success -> this
        is Failure -> {
            action(error)
            this
        }
    }
}

/**
 * Represents an error with a message, code, and optional throwable.
 */
data class Error(
    val message: String,
    val code: String = "UNKNOWN",
    val throwable: Throwable? = null
) {
    companion object {
        fun network(message: String = "Network error", throwable: Throwable? = null) =
            Error(message, "NETWORK_ERROR", throwable)
        fun server(message: String = "Server error", code: String = "SERVER_ERROR", throwable: Throwable? = null) =
            Error(message, code, throwable)
        fun auth(message: String = "Authentication required", throwable: Throwable? = null) =
            Error(message, "UNAUTHORIZED", throwable)
        fun forbidden(message: String = "Access denied", throwable: Throwable? = null) =
            Error(message, "FORBIDDEN", throwable)
        fun notFound(message: String = "Resource not found", throwable: Throwable? = null) =
            Error(message, "NOT_FOUND", throwable)
        fun validation(message: String = "Validation failed", throwable: Throwable? = null) =
            Error(message, "VALIDATION_ERROR", throwable)
        fun unknown(message: String = "Unknown error", throwable: Throwable? = null) =
            Error(message, "UNKNOWN", throwable)
    }
}
