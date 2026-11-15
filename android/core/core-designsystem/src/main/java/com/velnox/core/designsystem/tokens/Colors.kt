package com.velnox.core.designsystem.tokens

import androidx.compose.ui.graphics.Color

/**
 * Velnox Color Tokens
 * Mapped directly from VELNOX_DESIGN_THEME.md v2.2
 * Source of truth: VELNOX_DESIGN_THEME.md §2 Core Color Tokens
 */
object VelnoxColors {

    // 2.1 Global surfaces and text
    // Page background: #f8fafc
    val Background = Color(0xFFF8FAFC)
    // Primary text: #0f172a
    val OnBackground = Color(0xFF0F172A)
    // Card/surface background: #ffffff
    val Surface = Color(0xFFFFFFFF)
    // Card text: #0f172a
    val OnSurface = Color(0xFF0F172A)
    // Dropdown/menu/sheet surface: #ffffff
    val SurfaceContainerHighest = Color(0xFFFFFFFF)
    // Popover text: #0f172a
    val OnSurfaceContainerHighest = Color(0xFF0F172A)

    // Muted surface: #f1f5f9 (from §5)
    val SurfaceVariant = Color(0xFFF1F5F9)
    // Border: #e2e8f0 (from §5)
    val Outline = Color(0xFFE2E8F0)
    // Outline variant (lighter)
    val OutlineVariant = Color(0xFFE2E8F0).copy(alpha = 0.5f)

    // 2.2 Primary / Buy - Dark slate
    // Primary: #0f172a
    val Primary = Color(0xFF0F172A)
    // On Primary: #ffffff
    val OnPrimary = Color(0xFFFFFFFF)
    // Primary Container (hover): #1e293b (slate-800)
    val PrimaryContainer = Color(0xFF1E293B)
    // On Primary Container
    val OnPrimaryContainer = Color(0xFFFFFFFF)

    // 2.3 Add to Cart / Brand - Emerald
    // Secondary (Emerald): #10B981
    val Secondary = Color(0xFF10B981)
    // On Secondary: #ffffff
    val OnSecondary = Color(0xFFFFFFFF)
    // Secondary Container (hover): #059669 (emerald-600)
    val SecondaryContainer = Color(0xFF059669)
    // On Secondary Container
    val OnSecondaryContainer = Color(0xFFFFFFFF)

    // 2.4 Semantic: Success - Emerald
    val Success = Color(0xFF10B981)
    val SuccessContainer = Color(0xFFECFDF5) // Light emerald background
    val OnSuccessContainer = Color(0xFF065F46)

    // 2.5 Semantic: Error/Destructive - Red
    val Error = Color(0xFFDC2626) // red-600
    val ErrorContainer = Color(0xFFFEF2F2) // Light red background
    val OnErrorContainer = Color(0xFF991B1B)

    // 2.6 Semantic: Warning/Pending - Amber
    val Warning = Color(0xFFF59E0B) // amber-500
    val WarningContainer = Color(0xFFFFFBEB) // Light amber background
    val OnWarningContainer = Color(0xFF92400E)

    // 2.7 Semantic: Info - Blue
    val Info = Color(0xFF3B82F6) // blue-500
    val InfoContainer = Color(0xFFEFF6FF) // Light blue background
    val OnInfoContainer = Color(0xFF1E40AF)

    // Additional semantic colors from theme
    // Disabled: Muted slate
    val Disabled = Color(0xFF94A3B8) // slate-400
    val OnDisabled = Color(0xFFFFFFFF).copy(alpha = 0.38f)

    // Focus ring: Emerald #10B981
    val Focus = Color(0xFF10B981)

    // Selected/Active: Emerald accent
    val Selected = Color(0xFF10B981)

    // Surface hierarchy (from §5)
    // Level 0: Page background
    val SurfaceLevel0 = Background
    // Level 1: Card
    val SurfaceLevel1 = Surface
    // Level 2: Popover/Sheet
    val SurfaceLevel2 = SurfaceContainerHighest
    // Level 3: Muted
    val SurfaceLevel3 = SurfaceVariant

    // Overlay scrim
    val Scrim = Color(0xFF0F172A).copy(alpha = 0.5f)

    // Shadow colors
    val ShadowLevel1 = Color(0xFF0F172A).copy(alpha = 0.05f) // shadow-sm
    val ShadowLevel2 = Color(0xFF0F172A).copy(alpha = 0.08f) // shadow-md
    val ShadowLevel3 = Color(0xFF0F172A).copy(alpha = 0.12f) // shadow-lg
}
