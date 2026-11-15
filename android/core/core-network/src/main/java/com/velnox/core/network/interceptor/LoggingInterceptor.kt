package com.velnox.core.network.interceptor

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.buffer
import okio.ByteString
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

/**
 * Logging interceptor for debugging network requests.
 * Only logs in debug builds.
 */
class LoggingInterceptor : Interceptor {

    private val TAG = "OkHttpLogging"
    private val MAX_BODY_LENGTH = 5000

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val startTime = System.nanoTime()

        // Log request
        if (BuildConfig.DEBUG) {
            logRequest(request)
        }

        val response = chain.proceed(request)
        val endTime = System.nanoTime()
        val durationMs = TimeUnit.NANOSECONDS.toMillis(endTime - startTime)

        // Log response
        if (BuildConfig.DEBUG) {
            logResponse(response, durationMs)
        }

        return response
    }

    private fun logRequest(request: Request) {
        val url = request.url.toString()
        val method = request.method
        val headers = request.headers.toMultimap()

        val sb = StringBuilder()
        sb.append("--> $method $url (${headers.size} headers)")
        sb.append("\n")

        // Log headers (excluding sensitive ones)
        headers.forEach { (name, values) ->
            if (!isSensitiveHeader(name)) {
                values.forEach { value ->
                    sb.append("$name: $value\n")
                }
            } else {
                sb.append("$name: ***REDACTED***\n")
            }
        }

        // Log body if present
        request.body?.let { body ->
            val buffer = okio.buffer(body.writeTo(okio.buffer()).buffer())
            val charset = StandardCharsets.UTF_8
            val bodyString = buffer.readString(charset)
            if (bodyString.length <= MAX_BODY_LENGTH) {
                sb.append("\nBody: $bodyString")
            } else {
                sb.append("\nBody: ${bodyString.substring(0, MAX_BODY_LENGTH)}... (truncated)")
            }
        }

        sb.append("\n--> END $method")
        Log.d(TAG, sb.toString())
    }

    private fun logResponse(response: Response, durationMs: Long) {
        val request = response.request
        val url = request.url.toString()
        val method = request.method
        val code = response.code
        val message = response.message

        val sb = StringBuilder()
        sb.append("<-- $code $message $method $url (${durationMs}ms)")
        sb.append("\n")

        // Log headers
        response.headers.toMultimap().forEach { (name, values) ->
            if (!isSensitiveHeader(name)) {
                values.forEach { value ->
                    sb.append("$name: $value\n")
                }
            }
        }

        // Log body
        response.body?.let { body ->
            val source = body.source()
            source.request(Long.MAX_VALUE) // Buffer the entire body
            val buffer = source.buffer().clone()
            val charset = StandardCharsets.UTF_8
            val bodyString = buffer.readString(charset)
            if (bodyString.length <= MAX_BODY_LENGTH) {
                sb.append("\nBody: $bodyString")
            } else {
                sb.append("\nBody: ${bodyString.substring(0, MAX_BODY_LENGTH)}... (truncated)")
            }
        }

        sb.append("\n<-- END HTTP")
        Log.d(TAG, sb.toString())
    }

    private fun isSensitiveHeader(name: String): Boolean {
        val sensitiveHeaders = setOf(
            "Authorization",
            "Cookie",
            "Set-Cookie",
            "X-CSRF-Token",
            "X-API-Key"
        )
        return name in sensitiveHeaders
    }
}
