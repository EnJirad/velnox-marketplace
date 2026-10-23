/**
 * CategoryPicker — hierarchical category picker for Velseller product creation.
 *
 * Architecture:
 * - Opens as a Radix Dialog on TOP of the parent ProductFormDialog
 * - Has its own controlled scroll context (no scroll bleed)
 * - Hierarchical navigation with breadcrumbs
 * - Search across all categories (localized names)
 * - Locale-aware (th/en/my) via useLanguage()
 * - Source of truth: backend /api/categories/tree (canonical category API)
 * - No hard-coded category tree — all data from backend
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@velnox/shared/components/ui/dialog";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  ChevronRight,
  ChevronLeft,
  Search,
  Check,
  FolderOpen,
  Folder,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────
export interface CategoryNode {
  id: string;
  slug: string;
  name?: string;
  display_name?: string;
  icon?: string;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
  names?: Record<string, string>;
  children?: CategoryNode[];
}

interface CategoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All category tree data (from /api/categories/tree) */
  categories: CategoryNode[];
  /** Currently selected category slug */
  value?: string;
  /** Callback when user selects a category */
  onSelect: (slug: string) => void;
  /** Loading state */
  loading?: boolean;
}

// ─── Flatten tree for search ──────────────────────────────────────────
function flattenTree(
  nodes: CategoryNode[],
  parentPath: string[] = [],
): (CategoryNode & { searchPath: string[]; depth: number })[] {
  const result: (CategoryNode & { searchPath: string[]; depth: number })[] = [];
  for (const node of nodes) {
    const display = node.display_name || node.name || node.slug;
    const path = [...parentPath, display];
    result.push({ ...node, searchPath: path, depth: parentPath.length });
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children, path));
    }
  }
  return result;
}

// ─── Get localized display name ───────────────────────────────────────
function getLocalizedName(
  node: CategoryNode,
  lang: string,
  fallbackLang = "en",
): string {
  // Try names localization first
  if (node.names && typeof node.names === "object") {
    if (node.names[lang]) return node.names[lang];
    if (node.names[fallbackLang]) return node.names[fallbackLang];
  }
  // Fall back to display_name, then name, then slug
  return node.display_name || node.name || node.slug || "";
}

// ─── Main Component ───────────────────────────────────────────────────
export function CategoryPicker({
  open,
  onOpenChange,
  categories,
  value,
  onSelect,
  loading = false,
}: CategoryPickerProps) {
  const { lang, t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState("");
  const [navigationStack, setNavigationStack] = useState<CategoryNode[]>([]);
  const [pendingSelection, setPendingSelection] = useState<string | null>(
    value ?? null,
  );

  // Current level to display
  const currentLevel = useMemo(() => {
    if (navigationStack.length === 0) return categories;
    return navigationStack[navigationStack.length - 1].children ?? [];
  }, [navigationStack, categories]);

  // Search results — search across all categories
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const all = flattenTree(categories);
    return all.filter((node) => {
      const display = getLocalizedName(node, lang);
      const slug = (node.slug || "").toLowerCase();
      const name = display.toLowerCase();
      return name.includes(q) || slug.includes(q);
    });
  }, [searchQuery, categories, lang]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setNavigationStack([]);
      setSearchQuery("");
      setPendingSelection(value ?? null);
    }
  }, [open, value]);

  const handleNavigateInto = useCallback((node: CategoryNode) => {
    if (node.children && node.children.length > 0) {
      setNavigationStack((prev) => [...prev, node]);
      setSearchQuery("");
    }
  }, []);

  const handleNavigateBack = useCallback(() => {
    setNavigationStack((prev) => prev.slice(0, -1));
  }, []);

  const handleNavigateToBreadcrumb = useCallback((index: number) => {
    setNavigationStack((prev) => prev.slice(0, index));
    setSearchQuery("");
  }, []);

  const handleSelect = useCallback(
    (slug: string) => {
      setPendingSelection(slug);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    if (pendingSelection) {
      onSelect(pendingSelection);
      onOpenChange(false);
    }
  }, [pendingSelection, onSelect, onOpenChange]);

  const handleCancel = useCallback(() => {
    setPendingSelection(value ?? null);
    onOpenChange(false);
  }, [value, onOpenChange]);

  const hasChildren = useCallback((node: CategoryNode) => {
    return !!(node.children && node.children.length > 0);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The picker renders its own localized close button in the header (below),
        // so disable the shared DialogContent close button — otherwise two X
        // buttons overlap in the top-right corner.
        showCloseButton={false}
        className="flex max-h-[85dvh] w-full min-w-0 flex-col overflow-hidden p-0 sm:max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <DialogHeader className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <DialogTitle className="min-w-0 flex-1 text-base font-semibold text-slate-900">
              {t("categoryPicker.title")}
            </DialogTitle>
            <button
              type="button"
              onClick={handleCancel}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label={t("categoryPicker.close")}
            >
              <X className="size-4" />
            </button>
          </div>
        </DialogHeader>

        {/* ── Search Bar ─────────────────────────────────────── */}
        <div className="w-full min-w-0 shrink-0 px-4 pt-3">
          <div className="relative w-full min-w-0">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("categoryPicker.search")}
              className="h-10 rounded-xl border-slate-200 pl-9 pr-8 text-sm"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Breadcrumbs ────────────────────────────────────── */}
        {navigationStack.length > 0 && !searchQuery && (
          <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-1 px-4 pt-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => handleNavigateToBreadcrumb(0)}
              className="shrink-0 rounded px-1 py-0.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#10B981]"
            >
              {t("categoryPicker.all")}
            </button>
            {navigationStack.map((node, idx) => (
              <span key={node.id} className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
                <ChevronRight className="size-3 shrink-0 text-slate-300" />
                <button
                  type="button"
                  onClick={() => handleNavigateToBreadcrumb(idx + 1)}
                  title={getLocalizedName(node, lang)}
                  className={`min-w-0 max-w-[8rem] truncate rounded px-1 py-0.5 font-medium transition-colors hover:bg-slate-100 sm:max-w-[14rem] ${
                    idx === navigationStack.length - 1
                      ? "text-[#10B981]"
                      : "text-slate-600 hover:text-[#10B981]"
                  }`}
                >
                  {getLocalizedName(node, lang)}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* ── Category List (ONLY THIS AREA SCROLLS) ─────────── */}
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <div className="size-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#10B981]" />
              <p className="mt-3 text-xs">{t("categoryPicker.loading")}</p>
            </div>
          ) : searchResults !== null ? (
            // ── Search Results ──
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Search className="mb-2 size-8 text-slate-200" />
                <p className="text-sm">{t("categoryPicker.noResults")}</p>
                <p className="mt-1 text-xs text-slate-300">
                  {t("categoryPicker.noResultsHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {searchResults.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => handleSelect(node.slug)}
                    title={getLocalizedName(node, lang)}
                    className={`flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-all ${
                      pendingSelection === node.slug
                        ? "bg-[#ECFDF5] ring-1 ring-[#10B981] text-[#059669]"
                        : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <FolderOpen className="size-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="w-full truncate text-sm font-medium">
                        {getLocalizedName(node, lang)}
                      </p>
                      {node.searchPath.length > 1 && (
                        <p className="mt-0.5 w-full truncate text-[11px] text-slate-400">
                          {node.searchPath.join(" › ")}
                        </p>
                      )}
                    </div>
                    {pendingSelection === node.slug && (
                      <Check className="size-4 shrink-0 text-[#10B981]" />
                    )}
                  </button>
                ))}
              </div>
            )
          ) : currentLevel.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Folder className="mb-2 size-8 text-slate-200" />
              <p className="text-sm">{t("categoryPicker.empty")}</p>
            </div>
          ) : (
            // ── Hierarchical Category List ──
            <div className="space-y-0.5">
              {currentLevel
                .filter((node) => node.is_active !== false)
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((node) => {
                  const active = pendingSelection === node.slug;
                  const isParent = hasChildren(node);
                  const childCount = node.children?.length ?? 0;

                  return (
                    <div
                      key={node.id}
                      // overflow-hidden is intentionally NOT set here: it would clip the
                      // child button's focus outline. The text chain below constrains
                      // width with min-w-0 + truncate instead.
                      className={`flex w-full min-w-0 items-center gap-1 rounded-xl transition-all ${
                        active
                          ? "bg-[#ECFDF5] ring-1 ring-[#10B981]"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      {/* Main button — select or navigate */}
                      <button
                        type="button"
                        onClick={() =>
                          isParent
                            ? handleNavigateInto(node)
                            : handleSelect(node.slug)
                        }
                        title={getLocalizedName(node, lang)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                      >
                        {isParent ? (
                          <Folder className="size-4 shrink-0 text-[#10B981]" />
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p
                            className={`w-full truncate text-sm font-medium ${
                              active ? "text-[#059669]" : "text-slate-700"
                            }`}
                          >
                            {getLocalizedName(node, lang)}
                          </p>
                          {isParent && (
                            <p className="mt-0.5 w-full truncate text-[11px] text-slate-400">
                              {t("categoryPicker.subcategories", { count: childCount })}
                            </p>
                          )}
                        </div>
                        {active && (
                          <Check className="size-4 shrink-0 text-[#10B981]" />
                        )}
                        {isParent && (
                          <ChevronRight className="size-4 shrink-0 text-slate-300" />
                        )}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* ── Footer with actions ────────────────────────────── */}
        <DialogFooter className="w-full min-w-0 shrink-0 border-t border-slate-100 px-4 py-3">
          {navigationStack.length > 0 && !searchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleNavigateBack}
              className="shrink-0 gap-1 text-slate-600"
            >
              <ChevronLeft className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t("categoryPicker.back")}</span>
            </Button>
          )}
          <div className="flex-1" />
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="border-slate-200"
            >
              {t("categoryPicker.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!pendingSelection}
              className="bg-[#10B981] text-white hover:bg-[#059669] disabled:opacity-50"
            >
              {t("categoryPicker.select")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
