# Velnox Android — UI Identity Mapping Document

> **Purpose**: Document the exact mapping from Velnox Web Design System (VELNOX_DESIGN_THEME.md v2.2) to Android Compose tokens. This ensures visual fidelity between web and native apps.

---

## 1. Logo Assets

| Asset | Web Source | Android Location | Notes |
|-------|------------|------------------|-------|
| **Primary Mark** | `.ai/velnox-logo-pack/svg/mark/velnox-mark-emerald.svg` | `app-*/res/drawable/ic_launcher_foreground.xml` | Emerald cross mark on dark slate background |
| **Wordmark** | `.ai/velnox-logo-pack/svg/wordmark/velnox-wordmark-emerald.svg` | Not yet implemented | For splash screens and headers |
| **Lockup Horizontal** | `.ai/velnox-logo-pack/svg/lockup-horizontal/velnox-horizontal-emerald.svg` | Not yet implemented | For marketing screens |
| **Lockup Stacked** | `.ai/velnox-logo-pack/svg/lockup-stacked/velnox-stacked-emerald.svg` | Not yet implemented | For app icon variants |

**Current Implementation**: Simplified vector in `ic_launcher_foreground.xml` using emerald cross (+) on dark slate circle.

---

## 2. Typography

| Token | Web (VELNOX_DESIGN_THEME.md §3) | Android (`VelnoxTypography.kt`) | Font Family |
|-------|----------------------------------|----------------------------------|-------------|
| **Display Large** | 57px / Bold | `displayLarge` = 57sp / Bold | Inter + Noto Sans Thai/Myanmar |
| **Display Medium** | 45px / Bold | `displayMedium` = 45sp / Bold | Inter + Noto Sans Thai/Myanmar |
| **Display Small** | 36px / Bold | `displaySmall` = 36sp / Bold | Inter + Noto Sans Thai/Myanmar |
| **Headline Large** | 32px / Bold | `headlineLarge` = 32sp / Bold | Inter + Noto Sans Thai/Myanmar |
| **Headline Medium** | 28px / Bold | `headlineMedium` = 28sp / Bold | Inter + Noto Sans Thai/Myanmar |
| **Headline Small** | 24px / SemiBold | `headlineSmall` = 24sp / SemiBold | Inter + Noto Sans Thai/Myanmar |
| **Title Large** | 22px / SemiBold | `titleLarge` = 22sp / SemiBold | Inter + Noto Sans Thai/Myanmar |
| **Title Medium** | 18px / Medium | `titleMedium` = 18sp / Medium | Inter + Noto Sans Thai/Myanmar |
| **Title Small** | 16px / Medium | `titleSmall` = 16sp / Medium | Inter + Noto Sans Thai/Myanmar |
| **Body Large** | 16px / Regular | `bodyLarge` = 16sp / Regular | Inter + Noto Sans Thai/Myanmar |
| **Body Medium** | 14px / Regular | `bodyMedium` = 14sp / Regular | Inter + Noto Sans Thai/Myanmar |
| **Body Small** | 12px / Regular | `bodySmall` = 12sp / Regular | Inter + Noto Sans Thai/Myanmar |
| **Label Large** | 14px / Medium | `labelLarge` = 14sp / Medium | Inter + Noto Sans Thai/Myanmar |
| **Label Medium** | 12px / Medium | `labelMedium` = 12sp / Medium | Inter + Noto Sans Thai/Myanmar |
| **Label Small** | 11px / Medium | `labelSmall` = 11sp / Medium | Inter + Noto Sans Thai/Myanmar |

**Font Stack**: System fonts with fallback chain: Inter → Noto Sans Thai → Noto Sans Myanmar

---

## 3. Colors

| Semantic Role | Web Token (VELNOX_DESIGN_THEME.md §2) | Android (`VelnoxColors.kt`) | Hex Value |
|---------------|----------------------------------------|------------------------------|-----------|
| **Page Background** | `--background` | `Background` | `#F8FAFC` |
| **Primary Text** | `--foreground` | `OnBackground` | `#0F172A` |
| **Card Surface** | `--card` | `Surface` | `#FFFFFF` |
| **Card Text** | `--card-foreground` | `OnSurface` | `#0F172A` |
| **Muted Surface** | - | `SurfaceVariant` | `#F1F5F9` |
| **Border** | - | `Outline` | `#E2E8F0` |
| **Primary (Buy Now)** | `--primary` | `Primary` | `#0F172A` (Dark Slate) |
| **On Primary** | `--primary-foreground` | `OnPrimary` | `#FFFFFF` |
| **Primary Container (Hover)** | - | `PrimaryContainer` | `#1E293B` |
| **Secondary (Add to Cart)** | `--secondary` | `Secondary` | `#10B981` (Emerald) |
| **On Secondary** | `--secondary-foreground` | `OnSecondary` | `#FFFFFF` |
| **Secondary Container (Hover)** | - | `SecondaryContainer` | `#059669` |
| **Success** | - | `Success` | `#10B981` |
| **Success Container** | - | `SuccessContainer` | `#ECFDF5` |
| **Error/Destructive** | - | `Error` | `#DC2626` |
| **Error Container** | - | `ErrorContainer` | `#FEF2F2` |
| **Warning/Pending** | - | `Warning` | `#F59E0B` |
| **Warning Container** | - | `WarningContainer` | `#FFFBEF` |
| **Info** | - | `Info` | `#3B82F6` |
| **Focus Ring** | - | `Focus` | `#10B981` |
| **Disabled** | - | `Disabled` | `#94A3B8` |

---

## 4. Spacing

| Token | Web (VELNOX_DESIGN_THEME.md §3.2) | Android (`VelnoxSpacing.kt`) | DP Value |
|-------|------------------------------------|------------------------------|----------|
| **none** | - | `none` | 0dp |
| **xxxs** | 2px | `xxxs` | 2dp |
| **xxs** | 4px | `xxs` | 4dp |
| **xs** | 6px | `xs` | 6dp |
| **sm** | 8px | `sm` | 8dp |
| **md** | 10px | `md` | 10dp |
| **lg** | 12px | `lg` | 12dp |
| **xl** | 16px | `xl` | 16dp |
| **xxl** | 20px | `xxl` | 20dp |
| **xxxl** | 24px | `xxxl` | 24dp |
| **xxxxl** | 32px | `xxxxl` | 32dp |
| **xxxxx** | 40px | `xxxxxl` | 40dp |
| **xxxxxx** | 48px | `xxxxxxl` | 48dp |

**Semantic Spacing**:
- `inset` = 8dp (standard inset)
- `gap` = 8dp (standard gap)
- `padding` = 10dp (standard padding)
- `cardPadding` = 12dp
- `buttonPaddingHorizontal` = 12dp
- `buttonPaddingVertical` = 8dp
- `screenPadding` = 12dp
- `headerHeight` = 56dp
- `tabBarHeight` = 64dp

---

## 5. Shapes (Border Radius)

| Component | Web (VELNOX_DESIGN_THEME.md §7) | Android (`VelnoxShapes.kt`) | DP Value |
|-----------|----------------------------------|------------------------------|----------|
| **Base** | `--radius: 0.75rem` | `base` | 12dp |
| **Buttons** | `rounded-squircle` | `buttonMedium` | 14dp |
| **Buttons Small** | `rounded-squircle-sm` | `buttonSmall` | 10dp |
| **Buttons Large** | `rounded-squircle-lg` | `buttonLarge` | 18dp |
| **Inputs** | `rounded-squircle` | `input` | 14dp |
| **Cards** | `rounded-squircle-lg` | `card` | 18dp |
| **Cards Large** | - | `cardLarge` | 24dp |
| **Badges** | `rounded-squircle-xs` | `badge` | 7dp |
| **Avatars** | `rounded-full` | `avatar` | 50dp (50%) |
| **Media Frames** | `rounded-squircle-lg` | `mediaFrame` | 18dp |
| **Circles** | `rounded-full` | `circle` | 50dp |
| **Switch Thumb** | `rounded-full` | `switchThumb` | 50dp |

> **Note**: True squircle not available in Compose; using `RoundedCornerShape` as approximation.

---

## 6. Elevation & Shadows

| Level | Web (VELNOX_DESIGN_THEME.md §6) | Android (`VelnoxElevation.kt`) | DP Value |
|-------|----------------------------------|------------------------------|----------|
| **Level 0** | `shadow-none` | `level0` / `flat` | 0dp |
| **Level 1** | `shadow-sm` | `level1` / `card` | 1dp |
| **Level 2** | `shadow-md` | `level2` / `elevated` | 4dp |
| **Level 3** | `shadow-lg` | `level3` / `modal` | 8dp |
| **Level 4** | - | `level4` / `overlay` | 16dp |

**Semantic Aliases**: `fab`=2, `fabPressed`=3, `bottomSheet`=3, `dialog`=4, `dropdown`=2, `tooltip`=1, `snackbar`=3

---

## 7. Icon Sizing

| Usage | Web (VELNOX_DESIGN_THEME.md §3.3) | Android (`VelnoxIcons.kt`) | DP Value |
|-------|------------------------------------|------------------------------|----------|
| **Inline Text** | - | `xxs` | 12dp |
| **Badges/Chips** | - | `xs` | 16dp |
| **Buttons/Tabs** | - | `sm` | 20dp |
| **Default (Material)** | - | `md` | 24dp |
| **FAB/Feature** | - | `lg` | 28dp |
| **Empty States** | - | `xl` | 32dp |
| **Hero** | - | `xxl` | 40dp |
| **Splash** | - | `xxxxl` | 56dp |

**Semantic**:
- `button` = 20dp
- `tab` = 20dp
- `actionBar` = 24dp
- `listItem` = 24dp
- `card` = 28dp
- `emptyState` = 40dp
- `iconButton` = 48dp (min touch target)

---

## 8. Button Semantics (VELNOX_DESIGN_THEME.md §4)

| Type | Web Implementation | Android Component | Colors |
|------|-------------------|-------------------|--------|
| **Primary (Buy Now)** | `bg-slate-900 text-white` | `VelnoxPrimaryButton` | Container: `#0F172A`, Content: `#FFFFFF` |
| **Add to Cart** | `bg-[#10B981] text-white` | `VelnoxAddToCartButton` | Container: `#10B981`, Content: `#FFFFFF` |
| **Secondary/Outline** | `border-slate-200 text-slate-700` | `VelnoxSecondaryButton` | Container: `surfaceVariant`, Content: `onSurfaceVariant` |
| **Ghost** | `ghost` + icon | `VelnoxGhostButton` | Transparent, icon only |
| **Destructive** | `border-red-200 text-red-600` | `VelnoxDestructiveButton` | Container: `errorContainer`, Content: `error` |

**Critical Rule**: Action-entry color continuity — if user enters Selection Sheet through specific action, that action keeps its semantic color inside the Sheet.

---

## 9. Card Variants (VELNOX_DESIGN_THEME.md §5)

| Variant | Web | Android Component | Usage |
|---------|-----|-------------------|-------|
| **Standard** | White, 18px radius, border `#E2E8F0` | `VelnoxCard` | Product cards, content cards |
| **Elevated** | White, 18px radius, shadow-md | `VelnoxElevatedCard` | Modals, sheets, high emphasis |
| **Product Card** | Image + title + price + actions | `VelnoxProductCard` | Product listings |
| **Content Card** | Title + subtitle + trailing | `VelnoxContentCard` | Settings, lists |
| **Info Card** | Colored accent border (2dp) | `VelnoxInfoCard` | Alerts, promotions |

---

## 10. Header & Navigation (VELNOX_DESIGN_THEME.md §10)

| Element | Web | Android |
|---------|-----|---------|
| **Header** | `sticky top-0 z-40`, `bg-white/90 backdrop-blur`, `border-b border-slate-200`, `h-14` | `TopAppBar` with `Modifier.statusBarsPadding()`, elevation 1dp, background `surface` at 90% opacity |
| **Mobile Tab Bar** | `fixed bottom-0 inset-x-0 z-50`, white bg, `border-t border-slate-200`, Active: Emerald, Inactive: Slate-400 | `NavigationBar` / `NavigationBarItem` with `NavigationBarItemDefaults` |

---

## 11. Product Options (VELNOX_DESIGN_THEME.md §11)

| Type | Web | Android |
|------|-----|---------|
| **IMAGE Option** (Color) | Thumbnail + label, Emerald selected ring | `VelnoxProductCard` / custom option picker with thumbnail + `Modifier.border(2.dp, Secondary)` |
| **TEXT Option** (Storage/Size) | Text only, no thumbnail | Text-only chip/group with selected state |
| **Variant Identity** | Match by `optionValue.id` | Match by `optionValue.id` (never display text) |

---

## 12. Product Gallery (VELNOX_DESIGN_THEME.md §12)

- Single unified state
- Variant selection drives image priority
- Thumbnail click/swipe returns control to unified gallery
- Main image synchronized with selected option

---

## 13. Cart Visuals (VELNOX_DESIGN_THEME.md §13)

- Cart image must correspond to selected IMAGE option / Variant
- Never use `product.images[0]` blindly
- Same product can have different cart images for different variants

---

## 14. Implementation Status

| Area | Status | Notes |
|------|--------|-------|
| **Color Tokens** | ✅ Complete | All mapped in `VelnoxColors.kt` |
| **Typography** | ✅ Complete | All mapped in `VelnoxTypography.kt` |
| **Spacing** | ✅ Complete | All mapped in `VelnoxSpacing.kt` |
| **Shapes** | ✅ Complete | All mapped in `VelnoxShapes.kt` (approx squircle) |
| **Elevation** | ✅ Complete | All mapped in `VelnoxElevation.kt` |
| **Icons** | ✅ Complete | All mapped in `VelnoxIcons.kt` |
| **Theme** | ✅ Complete | `VelnoxTheme.kt` wraps Material3 |
| **Button Components** | ✅ Complete | `VelnoxButton.kt` (5 variants) |
| **Card Components** | ✅ Complete | `VelnoxCard.kt` (5 variants) |
| **Input Components** | ✅ Complete | `VelnoxInput.kt` (TextField, Password, Search, Dropdown, TextArea) |
| **Logo Assets** | ⚠️ Partial | Simplified vector in `ic_launcher_foreground.xml`; need actual SVG import |
| **Font Loading** | ⚠️ System Only | Using system Inter + Noto Sans; custom font not bundled |
| **True Squircle** | ❌ Not Available | Compose uses `RoundedCornerShape`; squircle needs custom `Shape` impl |
| **Custom Font** | ❌ Not Bundled | Would need `.ttf` in `res/font/` and `FontFamily` config |

---

## 15. Next Steps for Visual Parity

1. **Import actual SVG logos** from `.ai/velnox-logo-pack/` into `drawable/` as `VectorDrawable` or `AnimatedVectorDrawable`
2. **Bundle Inter font** (Regular, Medium, SemiBold, Bold) + Noto Sans Thai/Myanmar in `res/font/`
3. **Implement true squircle Shape** using custom `Shape` with `Canvas` and rounded superellipse formula
4. **Add splash screen API** (Android 12+) using `WindowCompat.setDecorFitsSystemWindows` + `SplashScreen` compat library
5. **Screenshot comparison** — render key screens (Home, Product Detail, Cart, Checkout) and compare with web via pixel diff
6. **RTL/Myanmar layout testing** — verify mirrored layouts and font rendering

---

**Document Version**: 1.0
**Source of Truth**: VELNOX_DESIGN_THEME.md v2.2
**Last Updated**: Phase 1.1 Foundation Stabilization
