package com.velnox.core.datastore.preferences

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferencesKeys
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.preferencesDataStore
import androidx.datastore.preferences.core.stringPreferencesKey
import com.velnox.core.common.result.Error
import com.velnox.core.common.result.Result
import com.velnox.core.common.result.failure
import com.velnox.core.common.result.success
import kotlinx.coroutines.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/**
 * DataStore wrapper for non-sensitive preferences.
 * Uses Preferences DataStore (protobuf-backed) for type-safe storage.
 */
class PreferencesDataStore(private val context: Context) {

    private val dataStore = context.preferencesDataStore("velnox_prefs")

    // Preference keys
    companion object Keys {
        val LANGUAGE = stringPreferencesKey("language")
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val FIRST_LAUNCH = stringPreferencesKey("first_launch")
        val ONBOARDING_COMPLETED = stringPreferencesKey("onboarding_completed")
        val PUSH_NOTIFICATIONS_ENABLED = stringPreferencesKey("push_notifications_enabled")
        val CACHE_EXPIRY_HOURS = stringPreferencesKey("cache_expiry_hours")
        val LAST_SYNC_TIMESTAMP = stringPreferencesKey("last_sync_timestamp")
        val APP_VERSION = stringPreferencesKey("app_version")
        val BUILD_VERSION = stringPreferencesKey("build_version")
    }

    /**
     * Get a string preference as a Flow.
     */
    fun getStringFlow(key: Preferences.Key<String>): Flow<String?> {
        return dataStore.data
            .catch { exception ->
                // If there's an error reading, emit empty preferences
                emit(PreferencesFactory.emptyPreferences())
            }
            .map { it[key] }
    }

    /**
     * Get a string preference once (suspend).
     */
    suspend fun getString(key: Preferences.Key<String>): Result<String?> {
        return try {
            val prefs = dataStore.data.first()
            success(prefs[key])
        } catch (e: Exception) {
            failure(Error.server("Failed to read preference", "PREF_READ_FAILED", e))
        }
    }

    /**
     * Set a string preference.
     */
    suspend fun putString(key: Preferences.Key<String>, value: String?): Result<Unit> {
        return try {
            dataStore.edit { prefs ->
                value?.let { prefs[key] = it } ?: prefs.remove(key)
            }.await()
            success(Unit)
        } catch (e: Exception) {
            failure(Error.server("Failed to write preference", "PREF_WRITE_FAILED", e))
        }
    }

    /**
     * Remove a preference.
     */
    suspend fun remove(key: Preferences.Key<String>): Result<Unit> {
        return try {
            dataStore.edit { prefs ->
                prefs.remove(key)
            }.await()
            success(Unit)
        } catch (e: Exception) {
            failure(Error.server("Failed to remove preference", "PREF_REMOVE_FAILED", e))
        }
    }

    /**
     * Clear all preferences.
     */
    suspend fun clearAll(): Result<Unit> {
        return try {
            dataStore.edit { prefs ->
                prefs.clear()
            }.await()
            success(Unit)
        } catch (e: Exception) {
            failure(Error.server("Failed to clear preferences", "PREF_CLEAR_FAILED", e))
        }
    }

    // Convenience methods for common preferences
    suspend fun getLanguage(): Result<String> {
        return getString(Keys.LANGUAGE).map { it ?: "th" }
    }

    suspend fun setLanguage(language: String): Result<Unit> {
        return putString(Keys.LANGUAGE, language)
    }

    suspend fun getThemeMode(): Result<String> {
        return getString(Keys.THEME_MODE).map { it ?: "system" }
    }

    suspend fun setThemeMode(mode: String): Result<Unit> {
        return putString(Keys.THEME_MODE, mode)
    }

    suspend fun isFirstLaunch(): Result<Boolean> {
        return getString(Keys.FIRST_LAUNCH).map { it == null || it.toBoolean() }
    }

    suspend fun setFirstLaunchComplete(): Result<Unit> {
        return putString(Keys.FIRST_LAUNCH, "false")
    }

    suspend fun isOnboardingCompleted(): Result<Boolean> {
        return getString(Keys.ONBOARDING_COMPLETED).map { it?.toBoolean() == true }
    }

    suspend fun setOnboardingCompleted(): Result<Unit> {
        return putString(Keys.ONBOARDING_COMPLETED, "true")
    }

    suspend fun getAppVersion(): Result<String?> {
        return getString(Keys.APP_VERSION)
    }

    suspend fun setAppVersion(version: String): Result<Unit> {
        return putString(Keys.APP_VERSION, version)
    }

    suspend fun getBuildVersion(): Result<String?> {
        return getString(Keys.BUILD_VERSION)
    }

    suspend fun setBuildVersion(version: String): Result<Unit> {
        return putString(Keys.BUILD_VERSION, version)
    }
}
