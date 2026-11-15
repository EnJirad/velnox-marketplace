package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Auth DTOs matching the backend API structure.
 * Based on backend routes: GET /api/auth/me, POST /api/auth/logout
 * Google OAuth flow: GET /api/auth/google, GET /api/auth/google/callback
 */

data class AuthUserDto(
    @Json(name = "id") val id: String,
    @Json(name = "email") val email: String,
    @Json(name = "name") val name: String,
    @Json(name = "avatar") val avatar: String?,
    @Json(name = "cover_url") val coverUrl: String?,
    @Json(name = "phone") val phone: String?,
    @Json(name = "role") val role: String,
    @Json(name = "status") val status: String,
    @Json(name = "department") val department: String?,
    @Json(name = "email_verified") val emailVerified: Boolean,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class AuthMeResponse(
    @Json(name = "user") val user: AuthUserDto,
    @Json(name = "seller") val seller: SellerSummaryDto? = null,
    @Json(name = "customer_profile") val customerProfile: CustomerProfileDto? = null
)

data class SellerSummaryDto(
    @Json(name = "id") val id: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "shop_name") val shopName: String,
    @Json(name = "shop_slug") val shopSlug: String,
    @Json(name = "status") val status: String,
    @Json(name = "is_verified") val isVerified: Boolean,
    @Json(name = "commission_rate") val commissionRate: String,
    @Json(name = "created_at") val createdAt: String
)

data class CustomerProfileDto(
    @Json(name = "id") val id: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "date_of_birth") val dateOfBirth: String?,
    @Json(name = "gender") val gender: String?,
    @Json(name = "preferences") val preferences: Map<String, String>
)

/**
 * Token response (for native auth if implemented)
 */
data class TokenResponse(
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "token_type") val tokenType: String = "Bearer",
    @Json(name = "expires_in") val expiresIn: Int,
    @Json(name = "scope") val scope: String?
)

data class RefreshTokenRequest(
    @Json(name = "refresh_token") val refreshToken: String
)

data class RefreshTokenResponse(
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "token_type") val tokenType: String = "Bearer",
    @Json(name = "expires_in") val expiresIn: Int
)

/**
 * Google OAuth - for native implementation
 * Note: Current backend uses browser-based OAuth with httpOnly cookies
 * This DTO is for future native OAuth implementation
 */
data class GoogleAuthRequest(
    @Json(name = "id_token") val idToken: String,
    @Json(name = "access_token") val accessToken: String?
)

data class GoogleAuthResponse(
    @Json(name = "user") val user: AuthUserDto,
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "expires_in") val expiresIn: Int
)

/**
 * User role constants matching backend
 */
object UserRole {
    const val CUSTOMER = "customer"
    const val SELLER = "seller"
    const val ADMIN = "admin"
    const val STAFF = "staff"
    const val MANAGER = "manager"

    val ALL = listOf(CUSTOMER, SELLER, ADMIN, STAFF, MANAGER)
}

/**
 * User status constants
 */
object UserStatus {
    const val ACTIVE = "active"
    const val INACTIVE = "inactive"
    const val SUSPENDED = "suspended"
    const val PENDING_VERIFICATION = "pending_verification"

    val ALL = listOf(ACTIVE, INACTIVE, SUSPENDED, PENDING_VERIFICATION)
}
