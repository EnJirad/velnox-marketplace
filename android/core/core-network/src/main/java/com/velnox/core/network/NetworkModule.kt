package com.velnox.core.network

import android.content.Context
import com.velnox.core.common.constants.ApiConstants
import com.velnox.core.network.api.ApiService
import com.velnox.core.network.interceptor.AuthInterceptor
import com.velnox.core.network.interceptor.ErrorInterceptor
import com.velnox.core.network.interceptor.LoggingInterceptor
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import okhttp3.Cache
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import javax.inject.Singleton
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    private const val CONNECT_TIMEOUT = 30L
    private const val READ_TIMEOUT = 30L
    private const val WRITE_TIMEOUT = 30L
    private const val CACHE_SIZE = 10 * 1024 * 1024L // 10 MB

    @Provides
    @Singleton
    fun provideMoshi(): Moshi {
        return Moshi.Builder()
            .add(KotlinJsonAdapterFactory())
            .build()
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        @dagger.hilt.android.qualifiers.ApplicationContext context: Context,
        authInterceptor: AuthInterceptor,
        loggingInterceptor: LoggingInterceptor,
        errorInterceptor: ErrorInterceptor,
        moshi: Moshi
    ): OkHttpClient {
        val cache = Cache(context.cacheDir, CACHE_SIZE)

        val clientBuilder = OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT, TimeUnit.SECONDS)
            .cache(cache)
            .addInterceptor(loggingInterceptor)
            .addInterceptor(authInterceptor)
            .addInterceptor(errorInterceptor)
            .addNetworkInterceptor { chain ->
                val originalRequest = chain.request()
                val newRequest = originalRequest.newBuilder()
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "VelnoxAndroid/1.0.0")
                    .build()
                chain.proceed(newRequest)
            }
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .followSslRedirects(true)

        // Add cookie handling for httpOnly session cookies
        clientBuilder.cookieJar(CookieJar())

        return clientBuilder.build()
    }

    @Provides
    @Singleton
    fun provideLoggingInterceptor(): LoggingInterceptor {
        return LoggingInterceptor()
    }

    @Provides
    @Singleton
    fun provideAuthInterceptor(credentialStorage: KeyStoreCredentialStorage): AuthInterceptor {
        return AuthInterceptor(credentialStorage)
    }

    @Provides
    @Singleton
    fun provideErrorInterceptor(): ErrorInterceptor {
        return ErrorInterceptor()
    }

    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        moshi: Moshi
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl(ApiConstants.BASE_URL_PROD) // Will be overridden by build config
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    @Provides
    @Singleton
    fun provideApiService(retrofit: Retrofit): ApiService {
        return retrofit.create(ApiService::class.java)
    }

    /**
     * Cookie jar for handling httpOnly session cookies from backend.
     * Backend uses httpOnly cookies for session management.
     */
    class CookieJar : okhttp3.CookieJar {
        private val cookieStore = java.util.concurrent.ConcurrentHashMap<String, List<okhttp3.Cookie>>()

        override fun saveFromResponse(url: okhttp3.HttpUrl, cookies: List<okhttp3.Cookie>) {
            if (cookies.isNotEmpty()) {
                cookieStore[url.host()] = cookies
            }
        }

        override fun loadForRequest(url: okhttp3.HttpUrl): List<okhttp3.Cookie> {
            return cookieStore[url.host()] ?: emptyList()
        }
    }
}
