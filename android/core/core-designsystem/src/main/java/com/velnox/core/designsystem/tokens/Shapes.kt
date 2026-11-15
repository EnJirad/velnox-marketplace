package com.velnox.core.designsystem.tokens

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * Velnox Shape Tokens
 * Mapped from VELNOX_DESIGN_THEME.md v2.2
 * Source of truth: VELNOX_DESIGN_THEME.md §7 Border Radius
 *
 * Squircle shape language: rounded-squircle (14px base)
 * Using RoundedCornerShape as Compose doesn't have native squircle
 * For true squircle, use custom shape or Canvas
 */
object VelnoxShapes {

    // 7.1 Base radius: --radius: 0.75rem = 12px
    val base = RoundedCornerShape(12.dp)

    // 7.1 Buttons: rounded-squircle = 14px (sm: 10px, lg: 18px)
    val buttonSmall = RoundedCornerShape(10.dp)
    val buttonMedium = RoundedCornerShape(14.dp)
    val buttonLarge = RoundedCornerShape(18.dp)

    // 7.1 Inputs: rounded-squircle = 14px
    val input = RoundedCornerShape(14.dp)

    // 7.1 Cards: rounded-squircle-lg = 18px
    val card = RoundedCornerShape(18.dp)
    val cardLarge = RoundedCornerShape(24.dp)

    // 7.1 Badges: rounded-squircle-xs = 7px
    val badge = RoundedCornerShape(7.dp)

    // 7.1 Avatars: rounded-full
    val avatar = RoundedCornerShape(50.dp) // Compose uses 50% for circle

    // 7.1 Media frames: rounded-squircle-lg = 18px
    val mediaFrame = RoundedCornerShape(18.dp)

    // 7.1 Circles: rounded-full
    val circle = RoundedCornerShape(50.dp)

    // 7.1 Switch thumb: rounded-full
    val switchThumb = RoundedCornerShape(50.dp)

    // Additional semantic shapes
    val chip = RoundedCornerShape(10.dp)
    val dialog = RoundedCornerShape(28.dp)
    val bottomSheet = RoundedCornerShape(24.dp)
    val tooltip = RoundedCornerShape(8.dp)
    val dropdown = RoundedCornerShape(12.dp)
    val fab = RoundedCornerShape(16.dp)
    val extendedFab = RoundedCornerShape(16.dp)

    // Semantic aliases
    val small = buttonSmall
    val medium = buttonMedium
    val large = buttonLarge
    val extraLarge = cardLarge
}
