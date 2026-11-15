package com.velnox.core.datastore

import android.content.Context
import com.velnox.core.datastore.credential.KeyStoreCredentialStorage
import com.velnox.core.datastore.preferences.PreferencesDataStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DataStoreModule {

    @Provides
    @Singleton
    fun provideKeyStoreCredentialStorage(@dagger.hilt.android.qualifiers.ApplicationContext context: Context): KeyStoreCredentialStorage {
        return KeyStoreCredentialStorage(context)
    }

    @Provides
    @Singleton
    fun providePreferencesDataStore(@dagger.hilt.android.qualifiers.ApplicationContext context: Context): PreferencesDataStore {
        return PreferencesDataStore(context)
    }
}
