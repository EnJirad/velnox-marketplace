import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  type Locale,
  getStoredLocale,
  setStoredLocale,
} from "./config.js";

import th from "./locales/th.json";
import en from "./locales/en.json";
import my from "./locales/my.json";

const translations: Record<Locale, Record<string, unknown>> = { th, en, my };

function getNestedValue(obj: unknown, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    setStoredLocale(newLocale);
    document.documentElement.lang = newLocale;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string): string => {
      const value = getNestedValue(translations[locale], key);
      if (value !== undefined) return value;
      // Fallback to Thai
      const fallback = getNestedValue(translations[DEFAULT_LOCALE], key);
      if (fallback !== undefined) return fallback;
      // Return key itself as last resort
      return key;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

export { DEFAULT_LOCALE } from "./config.js";
export type { Locale } from "./config.js";
export { SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_FLAGS } from "./config.js";
