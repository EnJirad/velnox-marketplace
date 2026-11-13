"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "@velnox/shared/lib/utils";
import { apiBaseUrl as API_BASE } from "@velnox/shared/lib/sites";
import { useLanguage } from "@/lib/i18n";

/** Shape returned by GET /api/announcements (contract v2). */
interface AnnouncementRow {
  id: string;
  type: "announcement" | "promotion" | "ad";
  zone: "home" | "product" | "store";
  placement: string;
  slot: number;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  animation: "none" | "fade" | "slide-up" | "bounce";
  bgColor: string | null;
  textColor: string | null;
}

interface ProductBannerSlotProps {
  /** Placement key, e.g. "product_above_gallery". */
  placement: string;
  /** Fallback label shown in dev when no banner matches. */
  label?: string;
}

async function apiGet<T>(path: string): Promise<T> {
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data !== undefined ? json.data : json) as T;
}

function useAnnouncements(placement: string) {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<AnnouncementRow[] | { data: AnnouncementRow[] }>("/api/announcements");
      const arr = Array.isArray(data) ? data : data?.data ?? [];
      setRows(arr.filter((r) => r && r.placement === placement && r.active));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [placement]);

  useEffect(() => {
    let alive = true;
    load();
    return () => {
      alive = false;
    };
  }, [load]);

  return rows;
}

export function ProductBannerSlot({ placement, label }: ProductBannerSlotProps) {
  const { t } = useLanguage();
  const rows = useAnnouncements(placement);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  if (!mountedRef.current) return null;
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const bg = row.bgColor ?? "#f1f5f9";
        const color = row.textColor ?? "#0f172a";
        const anim = row.animation ?? "none";
        const isPromo = row.type === "promotion";
        const isAd = row.type === "ad";
        return (
          <div
            key={row.id}
            className={cn(
              "banner relative overflow-hidden rounded-squircle-lg border border-slate-200 box-shadow",
              anim === "fade" ? "animate-fade" : anim === "slide-up" ? "animate-slide-up" : anim === "bounce" ? "animate-bounce" : "",
              isPromo ? "bg-white" : "bg-[#f1f5f9]",
            )}
            style={{ backgroundColor: bg, color }}
          >
            {isPromo && row.imageUrl && (
              <div className="flex items-center gap-4 p-3 sm:p-4">
                <img src={row.imageUrl} alt="" className="shrink-0 h-20 w-20 sm:h-24 sm:w-24 rounded-squircle-sm object-cover border border-slate-200" />
                <div className="min-w-0 flex-1">
                  {row.title && (
                    <div className="text-xs font-bold text-slate-900 leading-tight">{row.title}</div>
                  )}
                  {row.subtitle && (
                    <div className="mt-0.5 text-2xs text-slate-600 leading-relaxed">{row.subtitle}</div>
                  )}
                  {row.ctaUrl && (
                    <Link
                      to={row.ctaUrl}
                      className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-squircle-sm bg-[#10b981] text-[#ffffff] text-[10px] font-bold hover:bg-[#059669]"
                    >
                      {row.ctaLabel || t("marketing.stripCta")} →
                    </Link>
                  )}
                </div>
              </div>
            )}
            {!isPromo && row.imageUrl && (
              <div className="aspect-[4/3] rounded-squircle-sm overflow-hidden border border-slate-200 bg-slate-100 mx-3 my-2 sm:mx-4 sm:my-3">
                <img src={row.imageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            {!isPromo && !row.imageUrl && (
              <div className="p-3 sm:p-4">
                {row.title && (
                  <div className="text-xs font-bold text-slate-900 leading-tight">{row.title}</div>
                )}
                {row.subtitle && (
                  <div className="mt-0.5 text-2xs text-slate-600 leading-relaxed">{row.subtitle}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
