/**
 * IconifyIconPicker — searchable dropdown for the local, offline Velnox icon
 * library (Lucide, Material Design Icons, Tabler, Phosphor, Font Awesome 6).
 *
 * - Collection selector (chips) + cross-collection search
 * - Real SVG previews rendered from local, lazily-loaded collection data
 * - Namespaced identifiers ("mdi:shopping", "tabler:device-laptop", …)
 * - Paginated results (never renders the whole catalog at once)
 * - No runtime requests to Iconify servers — everything is generated locally
 */
import { useEffect, useRef, useState } from "react";
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all"); // "all" or a collection prefix
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, LoadedCollectionData>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Drop any in-flight collection loads when the picker unmounts so a late
  // resolve never touches state of an unmounted tree.
  useEffect(() => {
    return () => {
      pendingRef.current.clear();
    };
  }, []);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

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

  const changeQuery = (q: string) => {
    setQuery(q);
    setPage(0);
  };
  const changeFilter = (f: string) => {
    setFilter(f);
    setPage(0);
  };

  const selectedValue = value.trim();

  return (
    <div ref={wrapRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-emerald-300"
        aria-haspopup="listbox"
        aria-expanded={open}
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

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 max-h-[70vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex flex-col gap-2 p-3">
            {/* Collection selector */}
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

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                placeholder={placeholder || "ค้นหาไอคอน..."}
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-emerald-400"
                autoFocus
              />
            </div>

            {/* Result count / license */}
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
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

            {/* Grid */}
            <div className="relative min-h-[120px]">
              {searching && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
                  <Loader2 className="size-5 animate-spin text-emerald-600" />
                </div>
              )}
              {result && result.items.length === 0 && !searching && (
                <p className="py-8 text-center text-sm text-slate-400">
                  {t("velcenter.categories.noIconsFound", { search: query })}
                </p>
              )}
              {result && result.items.length > 0 && (
                <div className="grid max-h-[46vh] grid-cols-5 gap-1 overflow-y-auto sm:grid-cols-8">
                  {result.items.map((r) => (
                    <IconCell
                      key={r.id}
                      item={r}
                      body={bodyFor(loaded[r.prefix], r.name)}
                      selected={selectedValue === r.id}
                      onSelect={() => onSelect(r.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {result && result.pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
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
        </div>
      )}
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
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
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
      onClick={onSelect}
      title={item.id}
      aria-label={item.id}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-colors",
        selected
          ? "border-emerald-500 bg-emerald-50"
          : "border-transparent hover:border-slate-200 hover:bg-slate-50",
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center text-slate-700">
        {body ? (
          <IconSvg body={body} className="size-5" />
        ) : (
          <Loader2 className="size-4 animate-spin text-slate-300" />
        )}
      </span>
      <span className="w-full truncate text-center text-[10px] text-slate-600">{item.name}</span>
      <span className="w-full truncate text-center text-[9px] text-slate-400">{item.prefix}</span>
    </button>
  );
}
