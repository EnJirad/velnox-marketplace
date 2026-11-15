package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Address DTOs matching the backend API structure.
 * Based on backend routes: GET /api/addresses, POST /api/addresses, PUT /api/addresses/:id, DELETE /api/addresses/:id
 */

data class AddressDto(
    @Json(name = "id") val id: String,
    @Json(name = "user_id") val userId: String,
    @Json(name = "label") val label: String,
    @Json(name = "recipient_name") val recipientName: String,
    @Json(name = "phone") val phone: String,
    @Json(name = "line1") val line1: String,
    @Json(name = "line2") val line2: String?,
    @Json(name = "subdistrict") val subdistrict: String,
    @Json(name = "district") val district: String,
    @Json(name = "city") val city: String,
    @Json(name = "province") val province: String,
    @Json(name = "postal_code") val postalCode: String,
    @Json(name = "country") val country: String = "TH",
    @Json(name = "is_default") val isDefault: Boolean,
    @Json(name = "latitude") val latitude: Double?,
    @Json(name = "longitude") val longitude: Double?,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class AddressListDto(
    @Json(name = "addresses") val addresses: List<AddressDto>
)

data class AddressCreateRequest(
    @Json(name = "label") val label: String = "Home",
    @Json(name = "recipient_name") val recipientName: String,
    @Json(name = "phone") val phone: String,
    @Json(name = "line1") val line1: String,
    @Json(name = "line2") val line2: String? = null,
    @Json(name = "subdistrict") val subdistrict: String,
    @Json(name = "district") val district: String,
    @Json(name = "city") val city: String,
    @Json(name = "province") val province: String,
    @Json(name = "postal_code") val postalCode: String,
    @Json(name = "country") val country: String = "TH",
    @Json(name = "is_default") val isDefault: Boolean = false,
    @Json(name = "latitude") val latitude: Double? = null,
    @Json(name = "longitude") val longitude: Double? = null
)

data class AddressUpdateRequest(
    @Json(name = "label") val label: String? = null,
    @Json(name = "recipient_name") val recipientName: String? = null,
    @Json(name = "phone") val phone: String? = null,
    @Json(name = "line1") val line1: String? = null,
    @Json(name = "line2") val line2: String? = null,
    @Json(name = "subdistrict") val subdistrict: String? = null,
    @Json(name = "district") val district: String? = null,
    @Json(name = "city") val city: String? = null,
    @Json(name = "province") val province: String? = null,
    @Json(name = "postal_code") val postalCode: String? = null,
    @Json(name = "country") val country: String? = null,
    @Json(name = "is_default") val isDefault: Boolean? = null,
    @Json(name = "latitude") val latitude: Double? = null,
    @Json(name = "longitude") val longitude: Double? = null
)
