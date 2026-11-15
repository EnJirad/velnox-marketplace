package com.velnox.core.designsystem.tokens

import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Velnox Icon Sizing Tokens
 * Mapped from VELNOX_DESIGN_THEME.md v2.2
 * Source of truth: VELNOX_DESIGN_THEME.md §3.3 Iconography
 */
object VelnoxIcons {

    // Standard icon sizes
    val xxs = 12.dp  // Inline text icons
    val xs = 16.dp   // Small icons (badges, chips)
    val sm = 20.dp   // Standard UI icons (buttons, tabs)
    val md = 24.dp   // Default icon size (Material standard)
    val lg = 28.dp   // Large icons (FAB, feature icons)
    val xl = 32.dp   // Extra large (empty states, headers)
    val xxl = 40.dp  // Hero icons
    val xxxl = 48.dp // Large hero icons
    val xxxxl = 56.dp // Splash/launch icons

    // Semantic sizes
    val button = sm      // 20dp - button icons
    val tab = sm         // 20dp - tab bar icons
    val actionBar = md   // 24dp - app bar actions
    val listItem = md    // 24dp - list item icons
    val card = lg        // 28dp - card media icons
    val emptyState = xxl // 40dp - empty state illustrations
    val avatar = xl      // 32dp - small avatars
    val avatarLarge = xxxl // 48dp - large avatars

    // Icon button sizes (touch targets)
    val iconButton = 48.dp   // Minimum touch target 44dp + padding
    val iconButtonSmall = 40.dp
    val iconButtonLarge = 56.dp

    // FAB
    val fab = 24.dp
    val fabExtended = 24.dp
}
