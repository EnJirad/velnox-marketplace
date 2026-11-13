import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useLanguage } from "@/lib/i18n";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";
import {
  CategoryIcon,
  type CategoryIconProps,
} from "@velnox/shared/components/ui/category-icon";
import {
  PRODUCT_CATEGORY_META,
  type StoreProductCategory,
} from "@velnox/shared/lib/commerce";

interface CategoryChipProps {
  id: StoreProductCategory;
  label: string;
  icon?: LucideIcon;
  /** Optional uploaded image URL (VelCenter category icon) — overrides lucide icon */
  imageUrl?: string;
  /** Optional stored Lucide icon name (VelCenter category icon) */
  iconName?: string;
  count?: number;
  isActive: boolean;
  onClick: (id: StoreProductCategory) => void;
}

/**
 * Individual category chip — horizontal scrollable strip.
 * Clean, pill-style with optional count badge.
 */
function CategoryChip({
  id,
  label,
  icon: Icon,
  imageUrl,
  iconName,
  count,
  isActive,
  onClick,
}: CategoryChipProps) {
  const iconProps: CategoryIconProps = {
    icon: iconName,
    imageUrl,
    className: "size-4",
  };
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        "shrink-0 flex items-center gap-1.5 rounded-squircle-sm px-3 py-1.5 text-sm font-medium transition-all",
        isActive
          ? "bg-emerald-600 text-white shadow-sm"
          : "bg-white text-slate-700 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50"
      )}
      aria-pressed={isActive}
    >
      {iconName || imageUrl ? (
        <CategoryIcon {...iconProps} />
      ) : Icon ? (
        <Icon className="size-3.5" />
      ) : null}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

interface CategoryStripProps {
  categories: Array<{
    id: StoreProductCategory;
    label: string;
    icon?: LucideIcon;
    imageUrl?: string;
    iconName?: string;
    count?: number;
  }>;
  activeCategory: StoreProductCategory | "all";
  onCategoryChange: (id: StoreProductCategory | "all") => void;
  showAll?: boolean;
  allLabel?: string;
}

/**
 * Horizontal scrollable category strip — Thaimart style.
 * Clean pill chips with horizontal scroll, optional "All" tab.
 */
export function CategoryStrip({
  categories,
  activeCategory,
  onCategoryChange,
  showAll = true,
  allLabel = "ทั้งหมด",
}: CategoryStripProps) {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // Check scroll position for arrow visibility
  const checkScroll = useCallback(() => {
    if (scrollRef.current) {
      setShowLeftArrow(scrollRef.current.scrollLeft > 10);
      setShowRightArrow(
        scrollRef.current.scrollLeft + scrollRef.current.clientWidth <
          scrollRef.current.scrollWidth - 10
      );
    }
  }, []);

  useEffect(() => {
    checkScroll();
    const handleScroll = () => checkScroll();
    const el = scrollRef.current;
    el?.addEventListener("scroll", handleScroll);
    return () => el?.removeEventListener("scroll", handleScroll);
  }, [checkScroll]);

  // Sync active category from URL
  const location = useLocation();
  const urlCategory = (new URLSearchParams(location.search).get("category") ??
    "all") as StoreProductCategory | "all";

  useEffect(() => {
    if (urlCategory !== activeCategory) {
      onCategoryChange(urlCategory);
    }
  }, [urlCategory, activeCategory, onCategoryChange]);

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -200, behavior: "smooth" });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 200, behavior: "smooth" });
  };

  return (
    <div className="bg-white border-b border-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6">
        <div className="relative">
          {/* Left scroll arrow */}
          {showLeftArrow && (
            <button
              type="button"
              onClick={scrollLeft}
              aria-label="เลื่อนซ้าย"
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex size-8 items-center justify-center rounded-squircle-sm bg-white/90 border border-slate-200 text-slate-600 shadow-md hover:bg-white transition-colors lg:hidden"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}

          <div
            ref={scrollRef}
            className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4"
            onScroll={checkScroll}
            role="tablist"
            aria-label={t("categoryStrip.ariaLabel")}
          >
            {showAll && (
              <button
                type="button"
                role="tab"
                onClick={() => onCategoryChange("all")}
                aria-selected={activeCategory === "all"}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-squircle-sm px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap",
                  activeCategory === "all"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-white text-slate-700 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50"
                )}
              >
                {allLabel}
              </button>
            )}

            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                role="tab"
                onClick={() => onCategoryChange(cat.id)}
                aria-selected={activeCategory === cat.id}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-squircle-sm px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap",
                  activeCategory === cat.id
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-white text-slate-700 border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50"
                )}
              >
                {cat.iconName || cat.imageUrl ? (
                  <CategoryIcon icon={cat.iconName} imageUrl={cat.imageUrl} className="size-4" />
                ) : cat.icon ? (
                  <cat.icon className="size-3.5" />
                ) : null}
                <span className="whitespace-nowrap">{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Right scroll arrow */}
          {showRightArrow && (
            <button
              type="button"
              onClick={scrollRight}
              aria-label="เลื่อนขวา"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex size-8 items-center justify-center rounded-squircle-sm bg-white/90 border border-slate-200 text-slate-600 shadow-md hover:bg-white transition-colors lg:hidden"
            >
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
