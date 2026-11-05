import React from "react";
import { Link } from "react-router";
import { cn } from "@velnox/shared/lib/utils";
import { ArrowRight, type LucideIcon } from "lucide-react";

interface SectionHeaderProps {
  /** Leading icon (emerald background circle) */
  icon?: LucideIcon;
  /** Section title */
  title: string;
  /** Optional subtitle/description */
  description?: string;
  /** "View all" link destination */
  viewAllHref?: string;
  /** "View all" link label (i18n key or plain text) */
  viewAllLabel?: string;
  /** Additional className */
  className?: string;
  /** Title color variant */
  titleVariant?: "default" | "emerald" | "slate";
}

export function SectionHeader({
  icon,
  title,
  description,
  viewAllHref,
  viewAllLabel,
  className,
  titleVariant = "default",
}: SectionHeaderProps) {
  const titleClasses = {
    default: "text-slate-900",
    emerald: "text-emerald-700",
    slate: "text-slate-600",
  }[titleVariant];

  return (
    <div className={cn("flex items-center justify-between gap-3 mb-4", className)}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            {React.createElement(icon, { className: "size-4", strokeWidth: 2.5 })}
          </span>
        )}
        <div>
          <h2 className={cn("text-base font-bold tracking-tight", titleClasses)}>
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-slate-400">{description}</p>
          )}
        </div>
      </div>
      {viewAllHref && viewAllLabel && (
        <Link
          to={viewAllHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
        >
          {viewAllLabel}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
