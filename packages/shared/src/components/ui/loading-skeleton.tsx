import { cn } from "@velnox/shared/lib/utils";

interface LoadingSkeletonProps {
  /** Variant: "card" | "list" | "table" | "product" | "avatar" */
  variant?: "card" | "list" | "table" | "product" | "avatar";
  /** Number of skeleton items to show */
  count?: number;
  /** Additional className */
  className?: string;
  /** Custom dimensions */
  width?: string | number;
  height?: string | number;
}

export function LoadingSkeleton({
  variant = "card",
  count = 1,
  className,
  width,
  height,
}: LoadingSkeletonProps) {
  const baseStyle = {
    width: width ?? "100%",
    height: height ?? "100%",
  };

  const skeletons = Array.from({ length: count }, (_, i) => (
    <div key={i} className={cn("animate-pulse", className)}>
      {variant === "card" && (
        <div className="h-64 rounded-xl border border-slate-200 bg-slate-50" style={baseStyle} />
      )}
      {variant === "product" && (
        <div className="space-y-3" style={baseStyle}>
          <div className="aspect-square rounded-xl border border-slate-200 bg-slate-50" />
          <div className="h-4 w-3/4 rounded bg-slate-100" />
          <div className="h-4 w-1/2 rounded bg-slate-100" />
          <div className="h-5 w-1/3 rounded bg-emerald-100" />
        </div>
      )}
      {variant === "list" && (
        <div className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 bg-white" style={baseStyle}>
          <div className="size-12 rounded-lg bg-slate-100 shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="h-4 w-3/4 rounded bg-slate-100" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
          </div>
        </div>
      )}
      {variant === "table" && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden" style={baseStyle}>
          <div className="grid grid-cols-6 gap-4 p-4 bg-slate-50 border-b border-slate-200">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-4 rounded bg-slate-100" style={{ width: i === 0 ? "60%" : "80%" }} />
            ))}
          </div>
          {[...Array(3)].map((_, row) => (
            <div key={row} className="grid grid-cols-6 gap-4 p-4 border-b border-slate-100 last:border-0">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-4 rounded bg-slate-50" style={{ width: i === 0 ? "60%" : "80%" }} />
              ))}
            </div>
          ))}
        </div>
      )}
      {variant === "avatar" && (
        <div className="size-10 rounded-full bg-slate-100 shrink-0" style={baseStyle} />
      )}
    </div>
  ));

  return (
    <div className={cn("space-y-3", variant === "table" && "space-y-0")}>
      {skeletons}
    </div>
  );
}

/** Convenience: product grid skeleton (4 columns on desktop) */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <LoadingSkeleton variant="product" count={count} />
    </div>
  );
}

/** Convenience: order list skeleton */
export function OrderListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      <LoadingSkeleton variant="list" count={count} />
    </div>
  );
}

/** Convenience: table skeleton */
export function TableSkeleton({ columns = 6, rows = 4 }: { columns?: number; rows?: number }) {
  return <LoadingSkeleton variant="table" count={rows} />;
}
