package com.velnox.core.designsystem.tokens

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp

/**
 * Velnox Typography Tokens
 * Mapped from VELNOX_DESIGN_THEME.md v2.2
 * Source of truth: VELNOX_DESIGN_THEME.md §3 Typography Scale
 *
 * Font: Inter + Noto Sans Thai/Myanmar
 * Weights: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
 */
object VelnoxTypography {

    // Font families - use system fonts with fallbacks
    private val interFamily = FontFamily.Default
    private val notoSansThaiFamily = FontFamily.Default // Will use system Noto Sans Thai
    private val notoSansMyanmarFamily = FontFamily.Default // Will use system Noto Sans Myanmar

    // Fallback font family for Thai/Myanmar support
    val fontFamily = FontFamily(
        listOf(
            interFamily,
            notoSansThaiFamily,
            notoSansMyanmarFamily
        )
    )

    // Base text style
    private val baseStyle = TextStyle(
        fontFamily = fontFamily,
        fontWeight = FontWeight.Normal,
        textAlign = TextAlign.Start,
        textDecoration = TextDecoration.None,
        lineHeight = 24.sp // Default line height
    )

    // 3.1 Display styles
    // Display Large: 57px / Bold
    val displayLarge = baseStyle.copy(
        fontSize = 57.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 64.sp,
        letterSpacing = -0.25.sp
    )

    // Display Medium: 45px / Bold
    val displayMedium = baseStyle.copy(
        fontSize = 45.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 52.sp,
        letterSpacing = 0.sp
    )

    // Display Small: 36px / Bold
    val displaySmall = baseStyle.copy(
        fontSize = 36.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 44.sp,
        letterSpacing = 0.sp
    )

    // 3.2 Headline styles
    // Headline Large: 32px / Bold
    val headlineLarge = baseStyle.copy(
        fontSize = 32.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 40.sp,
        letterSpacing = 0.sp
    )

    // Headline Medium: 28px / Bold
    val headlineMedium = baseStyle.copy(
        fontSize = 28.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 36.sp,
        letterSpacing = 0.sp
    )

    // Headline Small: 24px / SemiBold
    val headlineSmall = baseStyle.copy(
        fontSize = 24.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 32.sp,
        letterSpacing = 0.sp
    )

    // 3.3 Title styles
    // Title Large: 22px / SemiBold
    val titleLarge = baseStyle.copy(
        fontSize = 22.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 28.sp,
        letterSpacing = 0.sp
    )

    // Title Medium: 18px / Medium
    val titleMedium = baseStyle.copy(
        fontSize = 18.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp
    )

    // Title Small: 16px / Medium
    val titleSmall = baseStyle.copy(
        fontSize = 16.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 24.sp,
        letterSpacing = 0.1.sp
    )

    // 3.4 Body styles
    // Body Large: 16px / Regular
    val bodyLarge = baseStyle.copy(
        fontSize = 16.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp
    )

    // Body Medium: 14px / Regular
    val bodyMedium = baseStyle.copy(
        fontSize = 14.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp
    )

    // Body Small: 12px / Regular
    val bodySmall = baseStyle.copy(
        fontSize = 12.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp
    )

    // 3.5 Label styles
    // Label Large: 14px / Medium (buttons, tabs)
    val labelLarge = baseStyle.copy(
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp
    )

    // Label Medium: 12px / Medium
    val labelMedium = baseStyle.copy(
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp
    )

    // Label Small: 11px / Medium
    val labelSmall = baseStyle.copy(
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp
    )

    // Semantic aliases for easy usage
    // Main headings
    val h1 = displayLarge
    val h2 = displayMedium
    val h3 = displaySmall
    val h4 = headlineLarge
    val h5 = headlineMedium
    val h6 = headlineSmall

    // Product titles
    val productTitle = titleLarge
    val productSubtitle = titleMedium

    // Prices
    val priceLarge = displaySmall.copy(fontWeight = FontWeight.Bold)
    val priceMedium = headlineSmall.copy(fontWeight = FontWeight.Bold)
    val priceSmall = titleMedium.copy(fontWeight = FontWeight.SemiBold)

    // Button text
    val buttonText = labelLarge

    // Caption / helper text
    val caption = bodySmall

    // Overline (category labels, badges)
    val overline = labelSmall.copy(textTransform = TextTransform.Uppercase)
}
