/**
 * VelShop language selector — the original one.
 *
 * One component for desktop (label + chevron) and mobile (icon only); the
 * language itself is stored by the shared i18n provider (`velnox.shop.language`)
 * so every page, toast and form label switches together.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@velnox/shared/components/ui/dropdown-menu";
import {
  SUPPORTED_LANGUAGES,
  languageLabel,
  useLanguage,
  type Language,
} from "@velnox/shared/lib/i18n";
import { Check, ChevronDown, Languages } from "lucide-react";

export function LanguageSwitcher({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const { lang, setLang, t } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("header.ariaLanguage")}
        className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-[10px] px-2.5 text-sm font-medium text-slate-600 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#10B981] data-[state=open]:bg-slate-100"
      >
        {variant === "mobile" ? (
          <Languages className="size-5" />
        ) : (
          <>
            <Languages className="size-4" />
            <span className="hidden sm:inline">{languageLabel(lang)}</span>
            <ChevronDown className="hidden size-3.5 opacity-60 sm:block" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 bg-white">
        {SUPPORTED_LANGUAGES.map((option) => (
          <DropdownMenuItem
            key={option.code}
            className="cursor-pointer gap-2 py-2.5 text-sm text-slate-700 focus:bg-slate-50"
            onSelect={() => setLang(option.code as Language)}
          >
            <span className="flex-1">{option.label}</span>
            {lang === option.code && <Check className="size-4 text-[#10B981]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
