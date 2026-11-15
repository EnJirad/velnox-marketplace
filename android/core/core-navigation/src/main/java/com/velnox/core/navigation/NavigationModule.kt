package com.velnox.core.navigation

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NavigationModule {

    // Navigation module provides navigation utilities
    // Actual NavController is provided by Hilt Navigation Compose
    // This module can be extended for deep link handling, analytics, etc.

    @Provides
    @Singleton
    fun provideDeepLinkHandler(): DeepLinkHandler {
        return DeepLinkHandler()
    }
}

/**
 * Deep link handler for processing incoming links.
 */
class DeepLinkHandler {

    private val PRODUCT_PATTERN = "/product/(.+)".toRegex()
    private val ORDER_PATTERN = "/order/(.+)".toRegex()
    private val SHOP_PATTERN = "/shop/(.+)".toRegex()
    private val CATEGORY_PATTERN = "/category/(.+)".toRegex()

    /**
     * Parse a deep link URL and return the target route.
     */
    fun parseDeepLink(url: String): DeepLinkTarget? {
        return when {
            PRODUCT_PATTERN.matches(url) -> {
                val id = PRODUCT_PATTERN.find(url)?.groupValues?.get(1)
                id?.let { DeepLinkTarget.Product(it) }
            }
            ORDER_PATTERN.matches(url) -> {
                val id = ORDER_PATTERN.find(url)?.groupValues?.get(1)
                id?.let { DeepLinkTarget.Order(it) }
            }
            SHOP_PATTERN.matches(url) -> {
                val slug = SHOP_PATTERN.find(url)?.groupValues?.get(1)
                slug?.let { DeepLinkTarget.Shop(it) }
            }
            CATEGORY_PATTERN.matches(url) -> {
                val slug = CATEGORY_PATTERN.find(url)?.groupValues?.get(1)
                slug?.let { DeepLinkTarget.Category(it) }
            }
            else -> null
        }
    }

    /**
     * Check if a URL is a valid Velnox deep link.
     */
    fun isVelnoxDeepLink(url: String): Boolean {
        return parseDeepLink(url) != null
    }
}

/**
 * Deep link target types.
 */
sealed interface DeepLinkTarget {
    data class Product(val id: String) : DeepLinkTarget
    data class Order(val id: String) : DeepLinkTarget
    data class Shop(val slug: String) : DeepLinkTarget
    data class Category(val slug: String) : DeepLinkTarget
}
