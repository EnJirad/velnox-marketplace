/**
 * IconifyIconPicker — responsive modal dialog for the local, offline Velnox
 * icon library (Lucide, Material Design Icons, Tabler, Phosphor, Font Awesome 6).
 *
 * - Trigger opens a centered modal (replaces the old viewport-overflowing dropdown)
 * - Header: title / description / close / expand-fullscreen
 * - Search (with clear) + collection chips + cross-collection search
 * - Real SVG previews rendered from local, lazily-loaded collection data
 * - Temporary selection: nothing is applied until "Confirm" — cancel / ESC /
 *   close discard the temporary selection and keep the previous icon
 * - Expand / collapse only changes the panel geometry; all picker state
 *   (query, collection, page, scroll, temporary selection) is preserved
 * - Namespaced identifiers ("mdi:shopping", "tabler:device-laptop", …)
 * - Paginated results (never renders the whole catalog at once)
 * - No runtime requests to Iconify servers — everything is generated locally
 *
 * Uses @radix-ui/react-dialog for a11y: focus trap, ESC-to-close, body scroll
 * lock, focus restore to the trigger, aria-modal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  ICON_COLLECTION_LABELS,
  ICON_TOTAL_COUNT,
  collectionLicenseLine,
  searchIcons,
  loadCollection,
} from "@velnox/shared/lib/icons";
import type {
  IconSearchResult,
  SearchPage,
  LoadedCollectionData,
  IconBodyData,
} from "@velnox/shared/lib/icons";
import { IconSvg } from "@velnox/shared/lib/icons";
import { CategoryIcon } from "@velnox/shared/components/ui/category-icon";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Loader2,
  Search,
  Image,
  X,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";

const PAGE_SIZE = 48;

function bodyFor(data: LoadedCollectionData | undefined, name: string): IconBodyData | null {
  if (!data) return null;
  const direct: IconBodyData | undefined = data.icons[name];
  if (direct) return direct;
  // Resolve aliases to their parent (may chain; guarded against cycles).
  const seen = new Set<string>();
  let cur: string | undefined = name;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parentName: string | undefined = data.aliases[cur];
    if (!parentName) break;
    const resolved: IconBodyData | undefined = data.icons[parentName];
    if (resolved) return resolved;
    cur = parentName;
  }
  return null;
}

export function IconifyIconPicker({
  value,
  onSelect,
  placeholder,
}: {
  value: string;
  onSelect: (id: string) => void;
  placeholder?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Temporary selection — local to the modal; applied to the form only on Confirm.
  const [tempValue, setTempValue] = useState<string>("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all"); // "all" or a collection prefix
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, LoadedCollectionData>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const scrollBeforeModeRef = useRef(0);

  // Initialize the temporary selection from the current icon each time the
  // modal opens; closing/reopening always starts from the committed value.
  useEffect(() => {
    if (open) {
      setTempValue(value.trim());
      setExpanded(false);
      // Focus the search box once the dialog content is mounted.
      const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  // Drop any in-flight collection loads when the picker unmounts so a late
  // resolve never touches state of an unmounted tree.
  useEffect(() => {
    return () => {
      pendingRef.current.clear();
    };
  }, []);

  // Search over the local name index (paginated, on demand).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSearching(true);
    searchIcons({
      query,
      collection: filter === "all" ? undefined : filter,
      limit: PAGE_SIZE,
      page,
    })
      .then((res) => {
        if (alive) setResult(res);
      })
      .catch(() => {
        if (alive) setResult(null);
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [open, query, filter, page]);

  // Batch-load the body data for every collection present on the current page
  // (each collection is its own lazy chunk; cached in memory afterwards).
  useEffect(() => {
    if (!result) return;
    const prefixes = [...new Set(result.items.map((i) => i.prefix))];
    for (const p of prefixes) {
      if (loaded[p] || pendingRef.current.has(p)) continue;
      pendingRef.current.add(p);
      loadCollection(p)
        .then((d) => setLoaded((prev) => (prev[p] ? prev : { ...prev, [p]: d })))
        .finally(() => pendingRef.current.delete(p));
    }
  }, [result, loaded]);

  const changeQuery = useCallback((q: string) => {
    setQuery(q);
    setPage(0);
  }, []);
  const changeFilter = useCallback((f: string) => {
    setFilter(f);
    setPage(0);
  }, []);

  const handleConfirm = () => {
    // Apply the temporary selection to the form — nothing was written anywhere
    // before this; the category Save button owns persistence.
    if (tempValue) onSelect(tempValue);
    setOpen(false);
  };
  const handleCancel = () => {
    // Discard the temporary selection; the previous icon is untouched.
    setOpen(false);
  };
  const toggleExpanded = () => {
    scrollBeforeModeRef.current = gridScrollRef.current?.scrollTop ?? 0;
    setExpanded((e) => !e);
  };
  // Keep the grid scroll position across an expand/collapse geometry change.
  useEffect(() => {
    if (gridScrollRef.current) {
      gridScrollRef.current.scrollTop = scrollBeforeModeRef.current;
    }
  }, [expanded]);

  const selectedValue = value.trim();
  const hasTemp = tempValue.trim().length > 0;

  return (
    <div className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-emerald-300"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("velcenter.categories.iconPickerTriggerLabel")}
      >
        <span className="flex size-6 flex-shrink-0 items-center justify-center rounded-[6px] bg-emerald-50 text-emerald-600">
          {selectedValue ? (
            <CategoryIcon icon={selectedValue} className="size-4" />
          ) : (
            <Image className="size-4 text-slate-300" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
          {selectedValue || placeholder || "ค้นหาไอคอน..."}
        </span>
        <ChevronDown className="size-3.5 flex-shrink-0 text-slate-400" />
      </button>

      {/* Modal dialog */}
      <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            className={cn(
              "fixed z-[61] flex flex-col overflow-hidden bg-white shadow-xl outline-none",
              expanded
                ? "inset-0 h-full w-full rounded-none sm:inset-4 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-xl"
                : "left-1/2 top-1/2 h-[min(78dvh,34rem)] w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200",
            )}
          >
            {/* Header */}
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-base font-semibold text-slate-900">
                  {t("velcenter.categories.iconPickerModalTitle")}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-0.5 text-xs text-slate-500">
                  {t("velcenter.categories.iconPickerModalDesc")}
                </DialogPrimitive.Description>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={toggleExpanded}
                  aria-label={expanded ? t("velcenter.categories.iconPickerCollapse") : t("velcenter.categories.iconPickerExpand")}
                  title={expanded ? t("velcenter.categories.iconPickerCollapse") : t("velcenter.categories.iconPickerExpand")}
                  className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  aria-label={t("velcenter.categories.iconPickerClose")}
                  title={t("velcenter.categories.iconPickerClose")}
                  className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {/* Search + collection filters */}
            <div className="flex flex-col gap-2 border-b border-slate-100 p-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => changeQuery(e.target.value)}
                  placeholder={placeholder || "ค้นหาไอคอน..."}
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-9 text-sm outline-none focus:border-emerald-400"
                  aria-label={t("velcenter.categories.iconPickerSearchAria")}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => changeQuery("")}
                    aria-label={t("velcenter.categories.iconPickerClearSearch")}
                    title={t("velcenter.categories.iconPickerClearSearch")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <CollectionChip
                  active={filter === "all"}
                  label={t("velcenter.categories.iconPickerAll")}
                  sub={String(ICON_TOTAL_COUNT)}
                  onClick={() => changeFilter("all")}
                />
                {ICON_COLLECTION_LABELS.map((c) => (
                  <CollectionChip
                    key={c.prefix}
                    active={filter === c.prefix}
                    label={c.name}
                    sub={String(c.total)}
                    onClick={() => changeFilter(c.prefix)}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-2xs text-slate-400">
                <span>
                  {result
                    ? t("velcenter.categories.iconPickerResults", { count: result.total })
                    : t("velcenter.categories.iconPickerLoading")}
                </span>
                <span className="truncate">
                  {t("velcenter.categories.iconPickerLicense")}{" "}
                  {filter === "all"
                    ? t("velcenter.categories.iconPickerLicenseAll")
                    : collectionLicenseLine(filter)}
                </span>
              </div>
            </div>

            {/* Icon grid — the only scrollable region; header/footer stay fixed */}
            <div
              ref={gridScrollRef}
              aria-label={t("velcenter.categories.iconPickerGrid")}
              aria-busy={searching}
              className="relative min-h-[120px] flex-1 overflow-y-auto p-4"
            >
              {searching && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-emerald-600" />
                </div>
              )}
              {result && result.items.length === 0 && !searching && (
                <p className="py-10 text-center text-sm text-slate-400">
                  {t("velcenter.categories.noIconsFound", { search: query })}
                </p>
              )}
              {result && result.items.length > 0 && (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                  {result.items.map((r) => (
                    <IconCell
                      key={r.id}
                      item={r}
                      body={bodyFor(loaded[r.prefix], r.name)}
                      selected={hasTemp && tempValue === r.id}
                      onSelect={() => setTempValue(r.id)}
                    />
                  ))}
                </div>
              )}
              {result && result.pages > 1 && (
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={page <= 0 || searching}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="size-3.5" />
                    {t("velcenter.categories.iconPickerPrev")}
                  </Button>
                  <span className="text-xs text-slate-500">
                    {t("velcenter.categories.iconPickerPage", { page: page + 1, pages: result.pages })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={!result || page >= result.pages - 1 || searching}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("velcenter.categories.iconPickerNext")}
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-2 border-t border-slate-100 p-4">
              <Button type="button" variant="outline" onClick={handleCancel}>
                {t("velcenter.categories.iconPickerCancel")}
              </Button>
              <Button
                type="button"
                className="gap-1.5 bg-brand text-white hover:bg-emerald-600"
                onClick={handleConfirm}
                disabled={!hasTemp}
              >
                {t("velcenter.categories.iconPickerConfirm")}
              </Button>
            </footer>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

function CollectionChip({
  active,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 py-1 text-2xs transition-colors",
        active
          ? "border-emerald-600 bg-emerald-50 text-emerald-700"
          : "border-slate-200 text-slate-600 hover:border-emerald-300",
      )}
    >
      <span className="max-w-[120px] truncate font-medium">{label}</span>
      <span className={active ? "text-emerald-500" : "text-slate-400"}>{sub}</span>
    </button>
  );
}

function IconCell({
  item,
  body,
  selected,
  onSelect,
}: {
  item: IconSearchResult;
  body: IconBodyData | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      title={item.id}
      aria-label={item.id}
      className={cn(
        "flex min-w-0 flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors",
        selected
          ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300"
          : "border-transparent hover:border-slate-200 hover:bg-slate-50",
      )}
    >
      {/* Dedicated preview container — fixed size, centered, never overlapped */}
      <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-700">
        {body ? (
          <IconSvg body={body} size={26} />
        ) : (
          <Loader2 className="size-4 animate-spin text-slate-300" />
        )}
      </span>
      {/* Icon name lives on its own line below the preview — safe wrap, no overlap */}
      <span className="line-clamp-2 w-full break-words text-center text-2xs leading-tight text-slate-600">
        {item.name}
      </span>
      <span className="w-full truncate text-center text-2xs text-slate-400">{item.prefix}</span>
    </button>
  );
}
