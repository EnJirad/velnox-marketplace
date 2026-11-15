package com.velnox.core.auth

import com.velnox.core.auth.oauth.OAuthManager
import com.velnox.core.auth.token.JwtManager
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import com.velnox.core.datastore.preferences.PreferencesDataStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AuthModule {

    @Provides
    @Singleton
    fun provideJwtManager(credentialStorage: KeyStoreCredentialStorage): JwtManager {
        return JwtManager(credentialStorage)
    }

    @Provides
    @Singleton
    fun provideOAuthManager(
        @dagger.hilt.android.qualifiers.ApplicationContext context: Context,
        credentialStorage: KeyStoreCredentialStorage
    ): OAuthManager {
        return OAuthManager(context, credentialStorage)
    }

    @Provides
    @Singleton
    fun provideAuthRepository(
        apiService: com.velnox.core.network.api.ApiService,
        jwtManager: JwtManager,
        oAuthManager: OAuthManager,
        preferencesDataStore: PreferencesDataStore,
        credentialStorage: KeyStoreCredentialStorage
    ): AuthRepository {
        return AuthRepository(
            apiService = apiService,
            jwtManager = jwtManager,
            oAuthManager = oAuthManager,
            preferencesDataStore = preferencesDataStore,
            credentialStorage = credentialStorage
        )
    }
}
