import { CURRENCIES, type Currency } from "@velnox/types";

export function formatPrice(
  price: number,
  currency: Currency = "THB"
): string {
  const config = CURRENCIES[currency];
  return new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: config.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "…";
}

export function generateSessionId(): string {
  return (
    crypto.randomUUID?.() ||
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

export function getStoredCurrency(): Currency {
  if (typeof window === "undefined") return "THB";
  const stored = localStorage.getItem("velnox_currency");
  if (stored && (stored === "THB" || stored === "USD" || stored === "MMK")) {
    return stored as Currency;
  }
  return "THB";
}

export function setStoredCurrency(currency: Currency): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("velnox_currency", currency);
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
