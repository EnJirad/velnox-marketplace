package com.velnox.core.designsystem.theme

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import com.velnox.core.designsystem.tokens.VelnoxColors
import com.velnox.core.designsystem.tokens.VelnoxElevation
import com.velnox.core.designsystem.tokens.VelnoxIcons
import com.velnox.core.designsystem.tokens.VelnoxShapes
import com.velnox.core.designsystem.tokens.VelnoxSpacing
import com.velnox.core.designsystem.tokens.VelnoxTypography

/**
 * Velnox Material3 Theme
 * Central theme configuration combining all design tokens.
 * Source of truth: VELNOX_DESIGN_THEME.md v2.2
 */
object VelnoxTheme {

    // Light color scheme mapped from design tokens
    private val LightColorScheme = lightColorScheme(
        // Primary - Dark slate for primary actions
        primary = VelnoxColors.Primary,
        onPrimary = VelnoxColors.OnPrimary,
        primaryContainer = VelnoxColors.PrimaryContainer,
        onPrimaryContainer = VelnoxColors.OnPrimaryContainer,

        // Secondary - Emerald for Add to Cart / brand actions
        secondary = VelnoxColors.Secondary,
        onSecondary = VelnoxColors.OnSecondary,
        secondaryContainer = VelnoxColors.SecondaryContainer,
        onSecondaryContainer = VelnoxColors.OnSecondaryContainer,

        // Tertiary - Optional third color
        tertiary = VelnoxColors.Info,
        onTertiary = Color.White,
        tertiaryContainer = VelnoxColors.InfoContainer,
        onTertiaryContainer = VelnoxColors.OnInfoContainer,

        // Error - Red
        error = VelnoxColors.Error,
        onError = Color.White,
        errorContainer = VelnoxColors.ErrorContainer,
        onErrorContainer = VelnoxColors.OnErrorContainer,

        // Surface colors
        surface = VelnoxColors.Surface,
        onSurface = VelnoxColors.OnSurface,
        surfaceVariant = VelnoxColors.SurfaceVariant,
        onSurfaceVariant = VelnoxColors.OnSurface.copy(alpha = 0.7f),
        surfaceContainer = VelnoxColors.SurfaceVariant,
        surfaceContainerHigh = VelnoxColors.SurfaceVariant.copy(alpha = 0.8f),
        surfaceContainerHighest = VelnoxColors.SurfaceVariant.copy(alpha = 0.9f),
        surfaceContainerLow = VelnoxColors.Surface,
        surfaceContainerLowest = VelnoxColors.Surface,
        surfaceBright = VelnoxColors.Surface,
        surfaceDim = VelnoxColors.Surface.copy(alpha = 0.9f),

        // Background
        background = VelnoxColors.Background,
        onBackground = VelnoxColors.OnBackground,

        // Outline
        outline = VelnoxColors.Outline,
        outlineVariant = VelnoxColors.OutlineVariant,

        // Inverse
        inverseSurface = VelnoxColors.OnBackground,
        inverseOnSurface = VelnoxColors.Background,
        inversePrimary = VelnoxColors.PrimaryContainer,

        // Shadow
        shadow = VelnoxColors.ShadowLevel2,

        // Scrim
        scrim = VelnoxColors.Scrim,

        // Primary fixed (for dynamic color)
        primaryFixed = VelnoxColors.Primary,
        onPrimaryFixed = VelnoxColors.OnPrimary,
        primaryFixedDim = VelnoxColors.PrimaryContainer,
        onPrimaryFixedVariant = VelnoxColors.OnPrimaryContainer,

        // Secondary fixed
        secondaryFixed = VelnoxColors.Secondary,
        onSecondaryFixed = VelnoxColors.OnSecondary,
        secondaryFixedDim = VelnoxColors.SecondaryContainer,
        onSecondaryFixedVariant = VelnoxColors.OnSecondaryContainer,

        // Tertiary fixed
        tertiaryFixed = VelnoxColors.Info,
        onTertiaryFixed = Color.White,
        tertiaryFixedDim = VelnoxColors.InfoContainer,
        onTertiaryFixedVariant = VelnoxColors.OnInfoContainer
    )

    // Dark color scheme
    private val DarkColorScheme = darkColorScheme(
        // Primary - Lighter slate for dark mode
        primary = VelnoxColors.PrimaryContainer,
        onPrimary = VelnoxColors.OnPrimaryContainer,
        primaryContainer = VelnoxColors.Primary.copy(alpha = 0.8f),
        onPrimaryContainer = VelnoxColors.OnPrimary,

        // Secondary - Emerald
        secondary = VelnoxColors.SecondaryContainer,
        onSecondary = VelnoxColors.OnSecondaryContainer,
        secondaryContainer = VelnoxColors.Secondary.copy(alpha = 0.8f),
        onSecondaryContainer = VelnoxColors.OnSecondary,

        // Tertiary
        tertiary = VelnoxColors.InfoContainer,
        onTertiary = VelnoxColors.OnInfoContainer,
        tertiaryContainer = VelnoxColors.Info.copy(alpha = 0.8f),
        onTertiaryContainer = VelnoxColors.OnInfoContainer,

        // Error
        error = VelnoxColors.ErrorContainer,
        onError = VelnoxColors.OnErrorContainer,
        errorContainer = VelnoxColors.Error.copy(alpha = 0.8f),
        onErrorContainer = VelnoxColors.Error,

        // Surface colors
        surface = VelnoxColors.Surface.copy(alpha = 0.9f),
        onSurface = VelnoxColors.OnSurface,
        surfaceVariant = VelnoxColors.SurfaceVariant.copy(alpha = 0.5f),
        onSurfaceVariant = VelnoxColors.OnSurface.copy(alpha = 0.7f),
        surfaceContainer = VelnoxColors.SurfaceVariant.copy(alpha = 0.3f),
        surfaceContainerHigh = VelnoxColors.SurfaceVariant.copy(alpha = 0.4f),
        surfaceContainerHighest = VelnoxColors.SurfaceVariant.copy(alpha = 0.5f),
        surfaceContainerLow = VelnoxColors.Surface.copy(alpha = 0.2f),
        surfaceContainerLowest = VelnoxColors.Surface.copy(alpha = 0.05f),
        surfaceBright = VelnoxColors.Surface.copy(alpha = 0.9f),
        surfaceDim = VelnoxColors.Surface.copy(alpha = 0.1f),

        // Background
        background = VelnoxColors.Background.copy(alpha = 0.95f),
        onBackground = VelnoxColors.OnBackground,

        // Outline
        outline = VelnoxColors.Outline.copy(alpha = 0.5f),
        outlineVariant = VelnoxColors.OutlineVariant.copy(alpha = 0.3f),

        // Inverse
        inverseSurface = VelnoxColors.Background,
        inverseOnSurface = VelnoxColors.OnBackground,
        inversePrimary = VelnoxColors.Primary,

        // Shadow
        shadow = Color.Black,

        // Scrim
        scrim = Color.Black.copy(alpha = 0.6f),

        // Fixed colors
        primaryFixed = VelnoxColors.Primary,
        onPrimaryFixed = VelnoxColors.OnPrimary,
        primaryFixedDim = VelnoxColors.PrimaryContainer,
        onPrimaryFixedVariant = VelnoxColors.OnPrimaryContainer,

        secondaryFixed = VelnoxColors.Secondary,
        onSecondaryFixed = VelnoxColors.OnSecondary,
        secondaryFixedDim = VelnoxColors.SecondaryContainer,
        onSecondaryFixedVariant = VelnoxColors.OnSecondaryContainer,

        tertiaryFixed = VelnoxColors.Info,
        onTertiaryFixed = Color.White,
        tertiaryFixedDim = VelnoxColors.InfoContainer,
        onTertiaryFixedVariant = VelnoxColors.OnInfoContainer
    )

    /**
     * Get the appropriate color scheme for the current theme mode.
     */
    fun colorScheme(context: Context, darkTheme: Boolean = isSystemInDarkTheme()) =
        if (darkTheme) DarkColorScheme else LightColorScheme

    /**
     * Typography styles mapped from design tokens.
     */
    val typography = androidx.compose.material3.Typography(
        displayLarge = VelnoxTypography.displayLarge,
        displayMedium = VelnoxTypography.displayMedium,
        displaySmall = VelnoxTypography.displaySmall,
        headlineLarge = VelnoxTypography.headlineLarge,
        headlineMedium = VelnoxTypography.headlineMedium,
        headlineSmall = VelnoxTypography.headlineSmall,
        titleLarge = VelnoxTypography.titleLarge,
        titleMedium = VelnoxTypography.titleMedium,
        titleSmall = VelnoxTypography.titleSmall,
        bodyLarge = VelnoxTypography.bodyLarge,
        bodyMedium = VelnoxTypography.bodyMedium,
        bodySmall = VelnoxTypography.bodySmall,
        labelLarge = VelnoxTypography.labelLarge,
        labelMedium = VelnoxTypography.labelMedium,
        labelSmall = VelnoxTypography.labelSmall
    )

    /**
     * Shapes mapped from design tokens.
     */
    val shapes = androidx.compose.material3.Shapes(
        extraSmall = VelnoxShapes.badge,
        small = VelnoxShapes.buttonSmall,
        medium = VelnoxShapes.buttonMedium,
        large = VelnoxShapes.card,
        extraLarge = VelnoxShapes.cardLarge
    )

    /**
     * Elevation defaults.
     */
    @Composable
    fun ElevationDefaults() {
        // Elevation is handled via Shadow component in Material3
        // Custom shadows can be applied via Modifier.shadow()
    }
}

/**
 * Main Velnox Theme composable.
 * Wraps MaterialTheme with Velnox design tokens.
 */
@Composable
fun VelnoxTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = VelnoxTheme.colorScheme(LocalContext.current, darkTheme)

    MaterialTheme(
        colorScheme = colorScheme,
        typography = VelnoxTheme.typography,
        shapes = VelnoxTheme.shapes,
        content = content
    )
}

/**
 * Preview helper for theme development.
 */
@Composable
@Preview(name = "Light Theme")
fun VelnoxThemeLightPreview() {
    VelnoxTheme(darkTheme = false) {
        ThemePreviewContent()
    }
}

@Composable
@Preview(name = "Dark Theme")
fun VelnoxThemeDarkPreview() {
    VelnoxTheme(darkTheme = true) {
        ThemePreviewContent()
    }
}

@Composable
private fun ThemePreviewContent() {
    import androidx.compose.foundation.layout.Arrangement
    import androidx.compose.foundation.layout.Column
    import androidx.compose.foundation.layout.Row
    import androidx.compose.foundation.layout.fillMaxWidth
    import androidx.compose.foundation.layout.padding
    import androidx.compose.foundation.layout.size
    import androidx.compose.foundation.shape.RoundedCornerShape
    import androidx.compose.material3.Button
    import androidx.compose.material3.Card
    import androidx.compose.material3.Text
    import androidx.compose.runtime.Composable
    import androidx.compose.ui.Alignment
    import androidx.compose.ui.graphics.Color
    import androidx.compose.ui.text.font.FontWeight
    import androidx.compose.ui.unit.dp
    import androidx.compose.ui.unit.sp

    Column(
        modifier = androidx.compose.ui.Modifier
            .fillMaxWidth()
            .padding(VelnoxSpacing.screenPadding),
        verticalArrangement = Arrangement.spacedBy(VelnoxSpacing.lg)
    ) {
        // Color swatches
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(VelnoxSpacing.sm)
        ) {
            ColorSwatch("Primary", MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.onPrimary)
            ColorSwatch("Secondary", MaterialTheme.colorScheme.secondary, MaterialTheme.colorScheme.onSecondary)
            ColorSwatch("Surface", MaterialTheme.colorScheme.surface, MaterialTheme.colorScheme.onSurface)
            ColorSwatch("Background", MaterialTheme.colorScheme.background, MaterialTheme.colorScheme.onBackground)
        }

        // Typography samples
        Text("Display Large", style = MaterialTheme.typography.displayLarge, color = MaterialTheme.colorScheme.onBackground)
        Text("Headline Medium", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onBackground)
        Text("Title Large", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground)
        Text("Body Large", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground)
        Text("Label Large", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onBackground)

        // Buttons
        Row(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(VelnoxSpacing.sm)
        ) {
            Button(onClick = {}, colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            ), shape = VelnoxShapes.buttonMedium) {
                Text("Primary Button", style = MaterialTheme.typography.labelLarge)
            }
            Button(onClick = {}, colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.secondary,
                contentColor = MaterialTheme.colorScheme.onSecondary
            ), shape = VelnoxShapes.buttonMedium) {
                Text("Add to Cart", style = MaterialTheme.typography.labelLarge)
            }
            Button(onClick = {}, colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant
            ), shape = VelnoxShapes.buttonMedium) {
                Text("Outlined", style = MaterialTheme.typography.labelLarge)
            }
        }

        // Card
        Card(
            modifier = androidx.compose.ui.Modifier.fillMaxWidth(),
            elevation = VelnoxElevation.card,
            shape = VelnoxShapes.card
        ) {
            Column(
                modifier = androidx.compose.ui.Modifier
                    .fillMaxWidth()
                    .padding(VelnoxSpacing.cardPadding)
            ) {
                Text("Card Title", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = VelnoxSpacing.xs))
                Text("Card content with Velnox design tokens applied.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ColorSwatch(name: String, color: Color, onColor: Color) {
    import androidx.compose.foundation.layout.Box
    import androidx.compose.foundation.layout.Column
    import androidx.compose.foundation.layout.size
    import androidx.compose.foundation.shape.RoundedCornerShape
    import androidx.compose.material3.Text
    import androidx.compose.runtime.Composable
    import androidx.compose.ui.Alignment
    import androidx.compose.ui.graphics.Color
    import androidx.compose.ui.unit.dp
    import androidx.compose.ui.unit.sp

    Column(
        modifier = androidx.compose.ui.Modifier
            .size(80.dp)
            .padding(VelnoxSpacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = androidx.compose.ui.Modifier
                .fillMaxWidth()
                .size(60.dp)
                .background(color, RoundedCornerShape(VelnoxShapes.small))
        )
        androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.padding(top = VelnoxSpacing.xs))
        Text(name, fontSize = 10.sp, color = onColor.copy(alpha = 0.7f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
