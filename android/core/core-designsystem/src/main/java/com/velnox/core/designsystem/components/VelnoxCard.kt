package com.velnox.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.velnox.core.designsystem.tokens.VelnoxColors
import com.velnox.core.designsystem.tokens.VelnoxElevation
import com.velnox.core.designsystem.tokens.VelnoxIcons
import com.velnox.core.designsystem.tokens.VelnoxShapes
import com.velnox.core.designsystem.tokens.VelnoxSpacing
import com.velnox.core.designsystem.tokens.VelnoxTypography

/**
 * Velnox Card Components
 * Mapped from VELNOX_DESIGN_THEME.md v2.2 §5 Cards and Surfaces
 *
 * Standard: White surface, 18px radius, subtle border
 * Elevated: White surface, 18px radius, shadow-md
 */

/**
 * Standard card with border
 */
@Composable
fun VelnoxCard(
    modifier: Modifier = Modifier,
    elevation: androidx.compose.ui.unit.Dp = VelnoxElevation.card,
    shape: RoundedCornerShape = VelnoxShapes.card,
    borderColor: Color = VelnoxColors.Outline,
    borderWidth: androidx.compose.ui.unit.Dp = 1.dp,
    contentColor: Color = VelnoxColors.OnSurface,
    content: @Composable () -> Unit
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(VelnoxSpacing.cardPadding),
        elevation = elevation,
        shape = shape,
        border = androidx.compose.ui.graphics.drawscope.Stroke(borderWidth, borderColor),
        colors = CardDefaults.cardColors(
            containerColor = VelnoxColors.Surface,
            contentColor = contentColor
        )
    ) {
        content()
    }
}

/**
 * Elevated card with shadow (no border)
 */
@Composable
fun VelnoxElevatedCard(
    modifier: Modifier = Modifier,
    elevation: androidx.compose.ui.unit.Dp = VelnoxElevation.elevated,
    shape: RoundedCornerShape = VelnoxShapes.card,
    contentColor: Color = VelnoxColors.OnSurface,
    content: @Composable () -> Unit
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(VelnoxSpacing.cardPadding),
        elevation = elevation,
        shape = shape,
        colors = CardDefaults.cardColors(
            containerColor = VelnoxColors.Surface,
            contentColor = contentColor
        )
    ) {
        content()
    }
}

/**
 * Product card layout - matches Velnox web product card
 */
@Composable
fun VelnoxProductCard(
    modifier: Modifier = Modifier,
    imageUrl: String,
    title: String,
    price: String,
    originalPrice: String? = null,
    discountPercent: Int? = null,
    shopName: String? = null,
    rating: Float? = null,
    reviewCount: Int? = null,
    isFavorite: Boolean = false,
    onClick: () -> Unit,
    onFavoriteClick: (() -> Unit)? = null,
    addToCartAction: (() -> Unit)? = null,
    imageContentDescription: String = ""
) {
    VelnoxCard(
        modifier = modifier.fillMaxWidth(),
        onClick = onClick
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(VelnoxSpacing.sm)
        ) {
            // Product image with favorite button
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
            ) {
                // Product image
                androidx.compose.foundation.Image(
                    painter = androidx.compose.foundation.rememberAsyncImagePainter(imageUrl),
                    contentDescription = imageContentDescription,
                    contentScale = androidx.compose.foundation.layout.ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )

                // Favorite button
                if (onFavoriteClick != null) {
                    VelnoxGhostButton(
                        onClick = onFavoriteClick!!,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(VelnoxSpacing.xs),
                        icon = {
                            Icon(
                                imageVector = if (isFavorite) {
                                    androidx.compose.material.icons.filled.Favorite
                                } else {
                                    androidx.compose.material.icons.outlined.FavoriteBorder
                                },
                                contentDescription = if (isFavorite) "Remove from favorites" else "Add to favorites",
                                tint = if (isFavorite) VelnoxColors.Error else VelnoxColors.OnSurface.copy(alpha = 0.9f)
                            )
                        },
                        size = VelnoxIcons.iconButtonSmall
                    )
                }

                // Discount badge
                discountPercent?.let { percent ->
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(VelnoxSpacing.xs)
                    ) {
                        androidx.compose.material3.Badge(
                            badgeContent = {
                                Text(
                                    text = "-$percent%",
                                    style = VelnoxTypography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                    color = VelnoxColors.OnError
                                )
                            },
                            colors = androidx.compose.material3.BadgeDefaults.badgeColors(
                                containerColor = VelnoxColors.Error
                            )
                        ) {
                            Box() // Empty box for badge anchor
                        }
                    }
                }
            }

            // Product info
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(VelnoxSpacing.xxs)
            ) {
                // Shop name
                shopName?.let {
                    Text(
                        text = it,
                        style = VelnoxTypography.caption,
                        color = VelnoxColors.OnSurface.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                    )
                }

                // Title
                Text(
                    text = title,
                    style = VelnoxTypography.titleMedium,
                    color = VelnoxColors.OnSurface,
                    maxLines = 2,
                    overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                )

                // Rating
                rating?.let { r ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        androidx.compose.material3.RatingBar(
                            rating = r,
                            modifier = Modifier.wrapContentSize(),
                            stars = 5,
                            indicatorSize = VelnoxIcons.xs
                        )
                        reviewCount?.let { count ->
                            Text(
                                text = "($count)",
                                style = VelnoxTypography.caption,
                                color = VelnoxColors.OnSurface.copy(alpha = 0.6f),
                                modifier = Modifier.padding(start = VelnoxSpacing.xxs)
                            )
                        }
                    }
                }

                // Price row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(VelnoxSpacing.xs)
                ) {
                    Text(
                        text = price,
                        style = VelnoxTypography.priceMedium,
                        color = VelnoxColors.OnSurface
                    )
                    originalPrice?.let {
                        Text(
                            text = it,
                            style = VelnoxTypography.bodyMedium.copy(
                                fontWeight = FontWeight.Normal,
                                textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough
                            ),
                            color = VelnoxColors.OnSurface.copy(alpha = 0.5f)
                        )
                    }
                }

                // Add to cart button
                addToCartAction?.let {
                    VelnoxAddToCartButtonSmall(
                        onClick = it,
                        modifier = Modifier.fillMaxWidth(),
                        label = "Add to Cart"
                    )
                }
            }
        }
    }
}

/**
 * Simple content card
 */
@Composable
fun VelnoxContentCard(
    modifier: Modifier = Modifier,
    title: String,
    subtitle: String? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingContent: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null
) {
    VelnoxCard(
        modifier = modifier
            .fillMaxWidth()
            .padding(VelnoxSpacing.cardPadding),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            leadingIcon?.let {
                Box(
                    modifier = Modifier
                        .size(VelnoxIcons.lg)
                        .padding(end = VelnoxSpacing.sm)
                ) { it() }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(vertical = VelnoxSpacing.xs),
                verticalArrangement = Arrangement.spacedBy(VelnoxSpacing.xxs)
            ) {
                Text(
                    text = title,
                    style = VelnoxTypography.titleMedium,
                    color = VelnoxColors.OnSurface,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                )
                subtitle?.let {
                    Text(
                        text = it,
                        style = VelnoxTypography.bodyMedium,
                        color = VelnoxColors.OnSurface.copy(alpha = 0.6f),
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                    )
                }
            }

            trailingContent?.let {
                Box(
                    modifier = Modifier
                        .wrapContentSize()
                        .padding(start = VelnoxSpacing.sm)
                ) { it() }
            }
        }
    }
}

/**
 * Info card with colored accent border
 */
@Composable
fun VelnoxInfoCard(
    modifier: Modifier = Modifier,
    title: String,
    description: String,
    accentColor: Color = VelnoxColors.Secondary,
    icon: (@Composable () -> Unit)? = null,
    actionLabel: String? = null,
    onActionClick: (() -> Unit)? = null
) {
    VelnoxCard(
        modifier = modifier
            .fillMaxWidth()
            .padding(VelnoxSpacing.cardPadding),
        borderColor = accentColor,
        borderWidth = 2.dp
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(VelnoxSpacing.sm)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                icon?.let {
                    Box(
                        modifier = Modifier
                            .size(VelnoxIcons.md)
                            .padding(end = VelnoxSpacing.sm)
                    ) { it() }
                }
                Text(
                    text = title,
                    style = VelnoxTypography.titleMedium.copy(color = accentColor),
                    color = accentColor,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                )
            }

            Text(
                text = description,
                style = VelnoxTypography.bodyMedium,
                color = VelnoxColors.OnSurface.copy(alpha = 0.8f)
            )

            actionLabel?.let { label ->
                VelnoxGhostButton(
                    onClick = onActionClick!!,
                    modifier = Modifier.align(Alignment.End),
                    contentColor = accentColor
                ) {
                    Text(
                        text = label,
                        style = VelnoxTypography.labelMedium.copy(color = accentColor),
                        color = accentColor
                    )
                }
            }
        }
    }
}
