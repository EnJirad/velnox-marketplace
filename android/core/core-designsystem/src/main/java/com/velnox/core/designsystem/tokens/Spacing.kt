package com.velnox.core.designsystem.tokens

import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Velnox Spacing Tokens
 * Mapped from VELNOX_DESIGN_THEME.md v2.2
 * Source of truth: VELNOX_DESIGN_THEME.md §3.2 Spacing, §8 Layout
 *
 * Base unit: 4dp
 * Scale: 0.5x (2dp), 1x (4dp), 1.5x (6dp), 2x (8dp), 2.5x (10dp), 3x (12dp), 4x (16dp), 5x (20dp), 6x (24dp), 8x (32dp), 10x (40dp), 12x (48dp), 16x (64dp)
 */
object VelnoxSpacing {

    // Base scale
    val none = 0.dp
    val xxxs = 2.dp   // 0.5x
    val xxs = 4.dp    // 1x
    val xs = 6.dp     // 1.5x
    val sm = 8.dp     // 2x
    val md = 10.dp    // 2.5x
    val lg = 12.dp    // 3x
    val xl = 16.dp    // 4x
    val xxl = 20.dp   // 5x
    val xxxl = 24.dp  // 6x
    val xxxxl = 32.dp // 8x
    val xxxxxl = 40.dp // 10x
    val xxxxxxl = 48.dp // 12x
    val xxxxxxll = 64.dp // 16x

    // Semantic spacing
    val inset = sm          // 8dp - standard inset
    val insetSm = xs        // 6dp - small inset
    val insetLg = lg        // 12dp - large inset
    val insetXl = xl        // 16dp - extra large inset

    val gap = sm            // 8dp - standard gap
    val gapSm = xs          // 6dp - small gap
    val gapLg = lg          // 12dp - large gap
    val gapXl = xl          // 16dp - extra large gap

    val padding = md        // 10dp - standard padding
    val paddingSm = xs      // 6dp - small padding
    val paddingLg = xl      // 16dp - large padding
    val paddingXl = xxl     // 20dp - extra large padding

    val margin = md         // 10dp - standard margin
    val marginSm = xs       // 6dp - small margin
    val marginLg = xl       // 16dp - large margin
    val marginXl = xxl      // 20dp - extra large margin

    // Component-specific
    val cardPadding = lg        // 12dp - card internal padding (p-5 = 20px ≈ 12dp, p-6 = 24px ≈ 15dp)
    val cardPaddingSm = md      // 10dp
    val cardPaddingLg = xl      // 16dp

    val buttonPaddingHorizontal = lg  // 12dp
    val buttonPaddingVertical = sm    // 8dp
    val buttonPaddingHorizontalSm = md // 10dp
    val buttonPaddingVerticalSm = xs  // 6dp

    val inputPaddingHorizontal = md   // 10dp
    val inputPaddingVertical = sm     // 8dp

    val listItemSpacing = md          // 10dp
    val sectionSpacing = xxl          // 20dp
    val screenPadding = lg            // 12dp (px-4 sm:px-6 = 16px/24px ≈ 10/15dp)

    // Header height: approximately h-14 = 56px ≈ 35dp
    val headerHeight = 56.dp

    // Mobile tab bar height
    val tabBarHeight = 64.dp

    // Screen edge insets (safe area)
    val safeAreaTop = 24.dp
    val safeAreaBottom = 24.dp
}
