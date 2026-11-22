/**
 * @velnox/shared — Public Entry Point
 *
 * Provides shared UI components, utilities, and configuration for
 * Velnox storefront, seller, and operations center applications.
 */

// Utilities
export { cn } from "./lib/utils.js";
export * from "./lib/sites.js";
export * from "./lib/features.js";
export * from "./lib/app-shell.js";
export * from "./lib/flash-toast.js";
export * from "./lib/image-optimize.js";

// i18n
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  languageLabel,
  type Language,
} from "./lib/i18n/config.js";

// Components
export { AppHeader } from "./components/AppHeader.js";
export { LanguageSwitcher } from "./components/LanguageSwitcher.js";
export { Logo } from "./components/Logo.js";
export { LogoDropdown } from "./components/LogoDropdown.js";
export { MobileTabBar, type MobileTabItem } from "./components/MobileTabBar.js";
export { RequireAuth } from "./components/RequireAuth.js";
export { RequireRole } from "./components/RequireRole.js";
export { UserMenu } from "./components/UserMenu.js";
export { VerificationStatusLabel } from "./components/VerificationStatusLabel.js";
export { RealtimeProvider } from "./components/RealtimeProvider.js";
