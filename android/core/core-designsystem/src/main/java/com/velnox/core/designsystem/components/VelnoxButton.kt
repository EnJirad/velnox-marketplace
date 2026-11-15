package com.velnox.core.designsystem.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.velnox.core.designsystem.tokens.VelnoxColors
import com.velnox.core.designsystem.tokens.VelnoxIcons
import com.velnox.core.designsystem.tokens.VelnoxShapes
import com.velnox.core.designsystem.tokens.VelnoxSpacing
import com.velnox.core.designsystem.tokens.VelnoxTypography

/**
 * Velnox Button Components
 * Mapped from VELNOX_DESIGN_THEME.md v2.2 §4 Buttons
 *
 * Semantic button types:
 * - Primary: Dark slate (#0f172a) - Buy Now, main CTA
 * - AddToCart: Emerald (#10B981) - Add to Cart
 * - Secondary: Outline - Cancel, secondary actions
 * - Ghost: Icon buttons
 * - Destructive: Red outline - Delete
 */
@Composable
fun VelnoxPrimaryButton(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    isLoading: Boolean = false
) {
    Button(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = VelnoxSpacing.buttonPaddingHorizontal, vertical = VelnoxSpacing.buttonPaddingVertical),
        enabled = enabled && !isLoading,
        shape = VelnoxShapes.buttonMedium,
        colors = ButtonDefaults.buttonColors(
            containerColor = VelnoxColors.Primary,
            contentColor = VelnoxColors.OnPrimary,
            disabledContainerColor = VelnoxColors.Disabled,
            disabledContentColor = VelnoxColors.OnDisabled
        ),
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    ) {
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (isLoading) {
                androidx.compose.material3.CircularProgressIndicator(
                    modifier = androidx.compose.ui.Modifier.size(VelnoxIcons.sm),
                    color = VelnoxColors.OnPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                leadingIcon?.let {
                    Box(
                        modifier = androidx.compose.ui.Modifier
                            .size(VelnoxIcons.sm)
                            .padding(end = VelnoxSpacing.xs)
                    ) { it() }
                }
                Text(
                    text = label,
                    style = VelnoxTypography.buttonText.copy(fontWeight = FontWeight.Medium),
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                )
                trailingIcon?.let {
                    Box(
                        modifier = androidx.compose.ui.Modifier
                            .size(VelnoxIcons.sm)
                            .padding(start = VelnoxSpacing.xs)
                    ) { it() }
                }
            }
        }
    }
}

@Composable
fun VelnoxAddToCartButton(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String = "Add to Cart",
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    isLoading: Boolean = false
) {
    Button(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = VelnoxSpacing.buttonPaddingHorizontal, vertical = VelnoxSpacing.buttonPaddingVertical),
        enabled = enabled && !isLoading,
        shape = VelnoxShapes.buttonMedium,
        colors = ButtonDefaults.buttonColors(
            containerColor = VelnoxColors.Secondary,
            contentColor = VelnoxColors.OnSecondary,
            disabledContainerColor = VelnoxColors.Secondary.copy(alpha = 0.5f),
            disabledContentColor = VelnoxColors.OnSecondary.copy(alpha = 0.5f)
        ),
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    ) {
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (isLoading) {
                androidx.compose.material3.CircularProgressIndicator(
                    modifier = androidx.compose.ui.Modifier.size(VelnoxIcons.sm),
                    color = VelnoxColors.OnSecondary,
                    strokeWidth = 2.dp
                )
            } else {
                leadingIcon?.let {
                    Box(
                        modifier = androidx.compose.ui.Modifier
                            .size(VelnoxIcons.sm)
                            .padding(end = VelnoxSpacing.xs)
                    ) { it() }
                }
                Text(
                    text = label,
                    style = VelnoxTypography.buttonText.copy(fontWeight = FontWeight.Medium),
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
                )
                trailingIcon?.let {
                    Box(
                        modifier = androidx.compose.ui.Modifier
                            .size(VelnoxIcons.sm)
                            .padding(start = VelnoxSpacing.xs)
                    ) { it() }
                }
            }
        }
    }
}

@Composable
fun VelnoxSecondaryButton(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null
) {
    Button(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = VelnoxSpacing.buttonPaddingHorizontal, vertical = VelnoxSpacing.buttonPaddingVertical),
        enabled = enabled,
        shape = VelnoxShapes.buttonMedium,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        ),
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    ) {
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            leadingIcon?.let {
                Box(
                    modifier = androidx.compose.ui.Modifier
                        .size(VelnoxIcons.sm)
                        .padding(end = VelnoxSpacing.xs)
                ) { it() }
            }
            Text(
                text = label,
                style = VelnoxTypography.buttonText.copy(fontWeight = FontWeight.Medium),
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
            )
            trailingIcon?.let {
                Box(
                    modifier = androidx.compose.ui.Modifier
                        .size(VelnoxIcons.sm)
                        .padding(start = VelnoxSpacing.xs)
                ) { it() }
            }
        }
    }
}

@Composable
fun VelnoxOutlinedButton(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    borderColor: Color = VelnoxColors.Outline,
    contentColor: Color = VelnoxColors.OnSurface
) {
    Button(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = VelnoxSpacing.buttonPaddingHorizontal, vertical = VelnoxSpacing.buttonPaddingVertical),
        enabled = enabled,
        shape = VelnoxShapes.buttonMedium,
        colors = ButtonDefaults.buttonColors(
            containerColor = Color.Transparent,
            contentColor = contentColor,
            disabledContainerColor = Color.Transparent,
            disabledContentColor = contentColor.copy(alpha = 0.38f)
        ),
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
        border = androidx.compose.ui.graphics.drawscope.Stroke(1.dp, borderColor)
    ) {
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            leadingIcon?.let {
                Box(
                    modifier = androidx.compose.ui.Modifier
                        .size(VelnoxIcons.sm)
                        .padding(end = VelnoxSpacing.xs)
                ) { it() }
            }
            Text(
                text = label,
                style = VelnoxTypography.buttonText.copy(fontWeight = FontWeight.Medium),
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
            )
            trailingIcon?.let {
                Box(
                    modifier = androidx.compose.ui.Modifier
                        .size(VelnoxIcons.sm)
                        .padding(start = VelnoxSpacing.xs)
                ) { it() }
            }
        }
    }
}

@Composable
fun VelnoxGhostButton(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    icon: @Composable () -> Unit,
    size: androidx.compose.ui.unit.Dp = VelnoxIcons.iconButton,
    contentColor: Color = VelnoxColors.OnSurface
) {
    Button(
        onClick = onClick,
        modifier = modifier.size(size),
        enabled = enabled,
        shape = VelnoxShapes.circle,
        colors = ButtonDefaults.buttonColors(
            containerColor = Color.Transparent,
            contentColor = contentColor,
            disabledContainerColor = Color.Transparent,
            disabledContentColor = contentColor.copy(alpha = 0.38f)
        ),
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    ) {
        Box(
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .wrapContentSize(Alignment.Center),
            contentAlignment = Alignment.Center
        ) {
            icon()
        }
    }
}

@Composable
fun VelnoxDestructiveButton(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String = "Delete",
    leadingIcon: (@Composable () -> Unit)? = null
) {
    Button(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = VelnoxSpacing.buttonPaddingHorizontal, vertical = VelnoxSpacing.buttonPaddingVertical),
        enabled = enabled,
        shape = VelnoxShapes.buttonMedium,
        colors = ButtonDefaults.buttonColors(
            containerColor = VelnoxColors.ErrorContainer,
            contentColor = VelnoxColors.Error,
            disabledContainerColor = VelnoxColors.ErrorContainer.copy(alpha = 0.5f),
            disabledContentColor = VelnoxColors.Error.copy(alpha = 0.5f)
        ),
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    ) {
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            leadingIcon?.let {
                Box(
                    modifier = androidx.compose.ui.Modifier
                        .size(VelnoxIcons.sm)
                        .padding(end = VelnoxSpacing.xs)
                ) { it() }
            }
            Text(
                text = label,
                style = VelnoxTypography.buttonText.copy(fontWeight = FontWeight.Medium),
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = androidx.compose.ui.text.overflow.TextOverflow.Ellipsis
            )
        }
    }
}

// Size variants
@Composable
fun VelnoxPrimaryButtonSmall(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null
) {
    VelnoxPrimaryButton(
        onClick = onClick,
        modifier = modifier.padding(horizontal = VelnoxSpacing.buttonPaddingHorizontalSm, vertical = VelnoxSpacing.buttonPaddingVerticalSm),
        enabled = enabled,
        label = label,
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon
    )
}

@Composable
fun VelnoxAddToCartButtonSmall(
    onClick: () -> Unit,
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    enabled: Boolean = true,
    label: String = "Add to Cart",
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null
) {
    VelnoxAddToCartButton(
        onClick = onClick,
        modifier = modifier.padding(horizontal = VelnoxSpacing.buttonPaddingHorizontalSm, vertical = VelnoxSpacing.buttonPaddingVerticalSm),
        enabled = enabled,
        label = label,
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon
    )
}
