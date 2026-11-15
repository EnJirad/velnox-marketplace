package com.velnox.core.datastore.credential

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.velnox.core.common.result.Error
import com.velnox.core.common.result.Result
import com.velnox.core.common.result.failure
import com.velnox.core.common.result.success
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android Keystore-backed secure credential storage.
 * Uses AES-256-GCM with Android Keystore for hardware-backed encryption when available.
 *
 * Stores:
 * - JWT access tokens
 * - Refresh tokens
 * - OAuth state parameters
 * - Any sensitive string credentials
 */
class KeyStoreCredentialStorage(private val context: Context) {

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    }

    private val cipher: Cipher by lazy {
        Cipher.getInstance("AES/GCM/NoPadding")
    }

    private val masterKeyAlias = "velnox_master_key"
    private val prefsName = "velnox_secure_prefs"

    /**
     * Initialize the master key in Android Keystore.
     * Creates a new key if one doesn't exist.
     */
    private suspend fun ensureMasterKey(): Result<SecretKey> = withContext(Dispatchers.IO) {
        try {
            if (!keyStore.containsAlias(masterKeyAlias)) {
                val keyGenerator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    "AndroidKeyStore"
                )
                val spec = KeyGenParameterSpec.Builder(
                    masterKeyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                    .build()
                keyGenerator.init(spec)
                keyGenerator.generateKey()
            }
            val entry = keyStore.getEntry(masterKeyAlias, null) as KeyStore.SecretKeyEntry
            success(entry.secretKey)
        } catch (e: Exception) {
            failure(Error.server("Failed to initialize master key", "KEYSTORE_INIT_FAILED", e))
        }
    }

    /**
     * Encrypt a string value using the master key.
     */
    private suspend fun encrypt(plainText: String): Result<String> = withContext(Dispatchers.IO) {
        ensureMasterKey().flatMap { secretKey ->
            try {
                cipher.init(Cipher.ENCRYPT_MODE, secretKey)
                val iv = cipher.iv
                val plainBytes = plainText.toByteArray(StandardCharsets.UTF_8)
                val cipherText = cipher.doFinal(plainBytes)
                // Combine IV + ciphertext for storage
                val combined = iv + cipherText
                success(Base64.encodeToString(combined, Base64.NO_WRAP))
            } catch (e: Exception) {
                failure(Error.server("Encryption failed", "ENCRYPTION_FAILED", e))
            }
        }
    }

    /**
     * Decrypt a string value using the master key.
     */
    private suspend fun decrypt(encryptedText: String): Result<String> = withContext(Dispatchers.IO) {
        ensureMasterKey().flatMap { secretKey ->
            try {
                val combined = Base64.decode(encryptedText, Base64.NO_WRAP)
                val iv = combined.copyOfRange(0, 12) // GCM IV is 12 bytes
                val cipherText = combined.copyOfRange(12, combined.size)
                val gcmSpec = GCMParameterSpec(128, iv)
                cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec)
                val plainBytes = cipher.doFinal(cipherText)
                success(String(plainBytes, StandardCharsets.UTF_8))
            } catch (e: Exception) {
                failure(Error.server("Decryption failed", "DECRYPTION_FAILED", e))
            }
        }
    }

    /**
     * Store a credential securely.
     */
    suspend fun putString(key: String, value: String): Result<Unit> {
        return encrypt(value).flatMap { encrypted ->
            withContext(Dispatchers.IO) {
                try {
                    val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                    prefs.edit().putString(key, encrypted).apply()
                    success(Unit)
                } catch (e: Exception) {
                    failure(Error.server("Failed to store credential", "STORAGE_FAILED", e))
                }
            }
        }
    }

    /**
     * Retrieve a credential securely.
     */
    suspend fun getString(key: String): Result<String?> {
        return withContext(Dispatchers.IO) {
            try {
                val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                val encrypted = prefs.getString(key, null)
                if (encrypted == null) {
                    success(null)
                } else {
                    decrypt(encrypted)
                }
            } catch (e: Exception) {
                failure(Error.server("Failed to retrieve credential", "RETRIEVAL_FAILED", e))
            }
        }
    }

    /**
     * Remove a credential.
     */
    suspend fun remove(key: String): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                prefs.edit().remove(key).apply()
                success(Unit)
            } catch (e: Exception) {
                failure(Error.server("Failed to remove credential", "REMOVAL_FAILED", e))
            }
        }
    }

    /**
     * Check if a credential exists.
     */
    suspend fun contains(key: String): Boolean {
        return withContext(Dispatchers.IO) {
            val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            prefs.contains(key)
        }
    }

    /**
     * Clear all credentials.
     */
    suspend fun clearAll(): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                prefs.edit().clear().apply()
                success(Unit)
            } catch (e: Exception) {
                failure(Error.server("Failed to clear credentials", "CLEAR_FAILED", e))
            }
        }
    }
}

/**
 * High-level credential keys used across the app.
 */
object CredentialKeys {
    const val ACCESS_TOKEN = "access_token"
    const val REFRESH_TOKEN = "refresh_token"
    const val TOKEN_EXPIRY = "token_expiry"
    const val OAUTH_STATE = "oauth_state"
    const val OAUTH_CODE_VERIFIER = "oauth_code_verifier"
    const val USER_ID = "user_id"
    const val USER_EMAIL = "user_email"
    const val USER_ROLE = "user_role"
}
