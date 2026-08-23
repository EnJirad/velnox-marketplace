export const DEFAULT_LOCALE = "th" as const;

export const SUPPORTED_LOCALES = ["th", "en", "my"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  th: "ไทย",
  en: "English",
  my: "မြန်မာ",
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  th: "🇹🇭",
  en: "🇺🇸",
  my: "🇲🇲",
};

export function isValidLocale(locale: string): locale is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export function getStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = localStorage.getItem("velnox_locale");
  if (stored && isValidLocale(stored)) return stored;
  return DEFAULT_LOCALE;
}

export function setStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("velnox_locale", locale);
}
