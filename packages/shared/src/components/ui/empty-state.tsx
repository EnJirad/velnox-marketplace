import { cn } from "@velnox/shared/lib/utils";
import { type LucideIcon } from "lucide-react";
import { Button } from "@velnox/shared/components/ui/button";

interface EmptyStateProps {
  /** Icon to display in the circle */
  icon: LucideIcon;
  /** Main title */
  title: string;
  /** Description text */
  description?: string;
  /** Optional CTA button */
  action?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost";
  };
  /** Additional className */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "size-10 rounded-xl p-6",
  md: "size-14 rounded-2xl p-8",
  lg: "size-20 rounded-2xl p-12",
};

const titleSizes = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
};

const descSizes = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "md",
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", className)}>
      <span className={cn("flex items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 mb-4", sizeClasses[size])}>
        <Icon className="size-6" strokeWidth={2} />
      </span>
      <h3 className={cn("font-semibold text-slate-900 mb-1", titleSizes[size])}>
        {title}
      </h3>
      {description && (
        <p className={cn("text-slate-400 max-w-sm mx-auto mb-6", descSizes[size])}>
          {description}
        </p>
      )}
      {action && (
        <Button
          variant={action.variant ?? "default"}
          size={size === "sm" ? "sm" : size === "lg" ? "lg" : "default"}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
