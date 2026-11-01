/**
 * Language switcher — the ONE visible selector for TH / EN / MY.
 *
 * It uses the shared LanguageProvider (never its own state, never its own
 * storage), so switching is instantaneous and the choice survives a reload —
 * exactly the behaviour VelShop already had with its app-local switcher.
 * Labels are the languages' native names, so they are not translated.
 */
import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SUPPORTED_LANGUAGES, languageLabel } from "@velnox/shared/lib/i18n/config";
import { useLanguage } from "@velnox/shared/lib/i18n";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={languageLabel(lang)}
        className="flex size-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <Languages className="size-4" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Language"
          className="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {SUPPORTED_LANGUAGES.map((option) => (
            <li key={option.code}>
              <button
                type="button"
                role="option"
                aria-selected={option.code === lang}
                onClick={() => {
                  setLang(option.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  option.code === lang ? "font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {option.label}
                {option.code === lang && <Check className="size-3.5 text-emerald-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
