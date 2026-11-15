package com.velnox.core.network.dto

import com.squareup.moshi.Json

/**
 * Category DTOs matching the backend API structure.
 * Based on backend routes: GET /api/categories
 */

data class CategoryDto(
    @Json(name = "id") val id: String,
    @Json(name = "slug") val slug: String,
    @Json(name = "name") val name: String,
    @Json(name = "description") val description: String?,
    @Json(name = "icon") val icon: String?,
    @Json(name = "image_url") val imageUrl: String?,
    @Json(name = "parent_id") val parentId: String?,
    @Json(name = "level") val level: Int,
    @Json(name = "sort_order") val sortOrder: Int,
    @Json(name = "is_active") val isActive: Boolean,
    @Json(name = "children") val children: List<CategoryDto> = emptyList(),
    @Json(name = "product_count") val productCount: Int = 0,
    @Json(name = "created_at") val createdAt: String,
    @Json(name = "updated_at") val updatedAt: String
)

data class CategoryTreeDto(
    @Json(name = "categories") val categories: List<CategoryDto>
)

data class CategoryCreateRequest(
    @Json(name = "slug") val slug: String,
    @Json(name = "name") val name: String,
    @Json(name = "description") val description: String? = null,
    @Json(name = "icon") val icon: String? = null,
    @Json(name = "image_url") val imageUrl: String? = null,
    @Json(name = "parent_id") val parentId: String? = null,
    @Json(name = "sort_order") val sortOrder: Int = 0
)

data class CategoryUpdateRequest(
    @Json(name = "name") val name: String? = null,
    @Json(name = "description") val description: String? = null,
    @Json(name = "icon") val icon: String? = null,
    @Json(name = "image_url") val imageUrl: String? = null,
    @Json(name = "parent_id") val parentId: String? = null,
    @Json(name = "sort_order") val sortOrder: Int? = null,
    @Json(name = "is_active") val isActive: Boolean? = null
)
