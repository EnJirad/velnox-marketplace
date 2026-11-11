import { cn } from "@velnox/shared/lib/utils";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { ShieldCheck } from "lucide-react";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "suspended";

export function VerificationStatusLabel({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  const { t } = useLanguage();

  const config: Record<
    VerificationStatus,
    { label: string; className: string }
  > = {
    unverified: {
      label: t("verification.statusUnverified"),
      className: "text-slate-400",
    },
    pending: {
      label: t("verification.statusPending"),
      className: "text-amber-600",
    },
    verified: {
      label: t("verification.statusVerified"),
      className: "text-emerald-600",
    },
    rejected: {
      label: t("verification.statusRejected"),
      className: "text-red-500",
    },
    suspended: {
      label: t("verification.statusSuspended"),
      className: "text-orange-500",
    },
  };

  const { label, className: statusClassName } = config[status] ?? config.unverified;

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", statusClassName, className)}>
      <ShieldCheck className="size-3" />
      {label}
    </span>
  );
}
