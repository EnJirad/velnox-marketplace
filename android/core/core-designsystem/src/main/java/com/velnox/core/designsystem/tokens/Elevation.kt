package com.velnox.core.designsystem.tokens

import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.unit.dp

/**
 * Velnox Elevation Tokens
 * Mapped from VELNOX_DESIGN_THEME.md v2.2
 * Source of truth: VELNOX_DESIGN_THEME.md §6 Shadows / Elevation
 *
 * Use restrained elevation:
 * Level 0: shadow-none - Flat content
 * Level 1: shadow-sm - Subtle cards/controls
 * Level 2: shadow-md - Elevated surfaces
 * Level 3: shadow-lg - Modal/Sheet/high elevation
 */
object VelnoxElevation {

    // Level 0: Flat content - no shadow
    val level0 = 0.dp
    val shadow0 = Shadow(elevation = 0.dp, shape = null)

    // Level 1: Subtle cards/controls - shadow-sm
    val level1 = 1.dp
    val shadow1 = Shadow(
        elevation = 1.dp,
        shape = null
    )

    // Level 2: Elevated surfaces - shadow-md
    val level2 = 4.dp
    val shadow2 = Shadow(
        elevation = 4.dp,
        shape = null
    )

    // Level 3: Modal/Sheet/high elevation - shadow-lg
    val level3 = 8.dp
    val shadow3 = Shadow(
        elevation = 8.dp,
        shape = null
    )

    // Level 4: Overlay/Dialog - higher elevation
    val level4 = 16.dp
    val shadow4 = Shadow(
        elevation = 16.dp,
        shape = null
    )

    // Semantic aliases
    val flat = level0
    val card = level1
    val elevated = level2
    val modal = level3
    val overlay = level4
    val fab = level2
    val fabPressed = level3
    val bottomSheet = level3
    val dialog = level4
    val dropdown = level2
    val tooltip = level1
    val snackbar = level3

    // Custom shadows with color (for specific use cases)
    // Using the shadow color tokens from Colors.kt
}
