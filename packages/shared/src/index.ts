/**
 * @velnox/shared — Public Entry Point
 *
 * Provides shared UI components, utilities, and configuration for
 * Velnox storefront, seller, and operations center applications.
 */

// Utilities
export { cn } from "./lib/utils";
export * from "./lib/sites";
export * from "./lib/features";
export * from "./lib/app-shell";
export * from "./lib/flash-toast";
export * from "./lib/image-optimize";

// i18n
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  languageLabel,
  type Language,
} from "./lib/i18n/config";

// Components
export { AppHeader } from "./components/AppHeader";
export { LanguageSwitcher } from "./components/LanguageSwitcher";
export { Logo } from "./components/Logo";
export { LogoDropdown } from "./components/LogoDropdown";
export { MobileTabBar, type MobileTabItem } from "./components/MobileTabBar";
export { RequireAuth } from "./components/RequireAuth";
export { RequireRole } from "./components/RequireRole";
export { UserMenu } from "./components/UserMenu";
export { VerificationStatusLabel } from "./components/VerificationStatusLabel";
export { RealtimeProvider } from "./components/RealtimeProvider";
