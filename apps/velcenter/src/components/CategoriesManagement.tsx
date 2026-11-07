/**
 * CategoriesManagement — Admin interface for Velnox Platform Categories.
 *
 * Features:
 * - Hierarchical tree view with expand/collapse
 * - Create / Edit / Delete categories
 * - Activate / Deactivate
 * - Drag-to-reorder (via sort_order)
 * - Product count display
 * - Search filtering
 * - Localized names
 */
import { api } from "@velnox/shared/lib/api-routes";
import { apiBaseUrl } from "@velnox/shared/lib/sites";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { onCenterEvent } from "../lib/center-events";
import { useLanguage } from "@velnox/shared/lib/i18n";
import React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  Search,
  Package,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  FolderTree,
  X,
} from "lucide-react";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Badge } from "@velnox/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { toast } from "sonner";

// Register Lucide icons globally for icon picker preview
if (typeof window !== "undefined") {
  (window as any).__lucideIcons = (window as any).__lucideIcons ?? {};
  // Register all imported icons and their PascalCase variants
  const iconMap = {
    Plus, Pencil, Trash2, ChevronRight, ChevronDown, Search, Package,
    Loader2, AlertCircle, Eye, EyeOff, FolderTree, X,
  };
  Object.entries(iconMap).forEach(([key, comp]) => {
    (window as any).__lucideIcons[key] = comp;
    // Also register camelCase version
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== key) (window as any).__lucideIcons[camel] = comp;
  });
}

/**
 * Lucide Icon Picker - searchable dropdown with icon preview.
 */
function LucideIconPicker({
  value,
  onChange,
  placeholder = "pim-chue-icon...",
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Common Lucide icon names (subset of most used)
  const lucideIcons = useMemo(() => [
    "camera", "store", "package", "shopping-bag", "shopping-cart", "truck",
    "heart", "star", "gem", "crown", "gift", "ticket", "tag", "ticket",
    "home", "building", "building-2", "warehouse", "factory", "shop",
    "phone", "smartphone", "tablet", "laptop", "monitor", "cpu", "hard-drive",
    "headphones", "music", "video", "camera", "image", "film", "mic",
    "book", "book-open", "graduation-cap", "pen", "pencil", "scissors",
    "folder", "file", "archive", "database", "server", "cloud", "globe",
    "map", "map-pin", "navigation", "compass", "anchor", "ship", "plane",
    "car", "bike", "bus", "train", "truck", "van", "package", "box",
    "bag", "briefcase", "wallet", "credit-card", "coins", "dollar-sign",
    "piggy-bank", "receipt", "invoice", "calculator", "chart", "bar-chart",
    "pie-chart", "trending-up", "trending-down", "activity", "zap", "battery",
    "plug", "wifi", "bluetooth", "settings", "cog", "tool", "hammer",
    "wrench", "screwdriver", "paintbrush", "palette", "brush", "spray-can",
    "user", "users", "user-plus", "user-minus", "user-check", "user-x",
    "shield", "shield-check", "shield-alert", "lock", "unlock", "key",
    "eye", "eye-off", "search", "zoom-in", "zoom-out", "filter", "funnel",
    "list", "grid", "layout", "columns", "rows", "split", "maximize",
    "minimize", "fullscreen", "rotate-cw", "rotate-ccw", "flip-h", "flip-v",
    "arrow-up", "arrow-down", "arrow-left", "arrow-right", "arrow-up-left",
    "arrow-up-right", "arrow-down-left", "arrow-down-right", "chevron-up",
    "chevron-down", "chevron-left", "chevron-right", "menu", "x", "plus",
    "minus", "check", "check-circle", "alert-circle", "alert-triangle",
    "info", "help-circle", "question-circle", "loader", "refresh-cw",
    "refresh-ccw", "repeat", "shuffle", "skip-back", "skip-forward",
    "play", "pause", "stop", "square", "circle", "triangle", "hexagon",
    "octagon", "star", "heart", "thumb-up", "thumb-down", "flag",
    "bookmark", "bell", "bell-off", "mail", "message", "send", "reply",
    "share", "share-2", "link", "unlink", "anchor", "paperclip", "clipboard",
    "copy", "cut", "paste", "save", "download", "upload", "cloud-download",
    "cloud-upload", "hard-drive", "memory-stick", "printer", "scanner",
    "fax", "phone", "voicemail", "contact", "address-book", "calendar",
    "clock", "timer", "stopwatch", "alarm", "calendar-plus", "calendar-minus",
    "calendar-x", "calendar-check", "calendar-heart", "calendar-search",
  ], []);

  const filteredIcons = useMemo(() => {
    if (!search) return lucideIcons.slice(0, 30);
    return lucideIcons.filter((name) =>
      name.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 30);
  }, [search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node) &&
          listRef.current && !listRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={listRef}>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        placeholder={placeholder}
        className="w-full"
      />
      {isOpen && search && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
          {filteredIcons.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                onChange(name);
                setSearch(name);
                setIsOpen(false);
                inputRef.current?.blur();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {/* Icon preview */}
              <span className="flex-shrink-0 w-8 flex items-center justify-center">
                {(() => {
                  // Try to get the icon from window.__lucideIcons (set globally)
                  const pascal = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                  const IconComp = (window as any).__lucideIcons?.[pascal];
                  if (IconComp) {
                    return <IconComp className="size-4 text-emerald-600" strokeWidth={2} />;
                  }
                  // Fallback: show abbreviated name in a colored badge
                  return (
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-emerald-100 text-[8px] font-bold text-emerald-700">
                      {name.slice(0, 2).toUpperCase()}
                    </span>
                  );
                })()}
              </span>
              <span className="font-medium">{name}</span>
            </button>
          ))}
          {filteredIcons.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-400 text-center">
              ไม่พบไอคอน "{search}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  parent_id?: string | null;
  sort_order: number;
  is_active: boolean;
  product_count?: number;
  child_count?: number;
  display_name?: string;
  display_description?: string;
  image_url?: string | null;
  description?: string | null;
  children: CategoryNode[];
}

type CategoryForm = {
  name: string;
  slug: string;
  icon: string;
  parent_id: string;
  sort_order: number;
  description: string;
  is_active: boolean;
};

const defaultForm: CategoryForm = {
  name: "",
  slug: "",
  icon: "",
  parent_id: "",
  sort_order: 0,
  description: "",
  is_active: true,
};

export default function CategoriesManagement() {
  const { t } = useLanguage();
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryNode | null>(null);
  const [form, setForm] = useState<CategoryForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<CategoryNode | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const rows = await api.centerAdmin.categoryList();
      const list = Array.isArray(rows) ? rows : [];
      // Build tree structure
      const byId = new Map<string, CategoryNode>();
      const roots: CategoryNode[] = [];
      for (const row of list) {
        byId.set(row.id, { ...row, children: [] });
      }
      for (const row of list) {
        const node = byId.get(row.id)!;
        if (row.parent_id && byId.has(row.parent_id)) {
          byId.get(row.parent_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      }
      setCategories(roots);
      // Auto-expand root nodes on first load
      setExpandedIds(new Set(roots.map((r) => r.id)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // Another VelCenter session changed the taxonomy (create / edit / delete) —
  // re-read the tree from the API. The event is only a signal; the data still
  // comes from the backend.
  useEffect(() => onCenterEvent("config", () => { void loadCategories(); }), [loadCategories]);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    const filterTree = (nodes: CategoryNode[]): CategoryNode[] => {
      return nodes
        .map((node) => {
          const matches =
            node.name.toLowerCase().includes(q) ||
            node.slug.toLowerCase().includes(q) ||
            (node.display_name ?? "").toLowerCase().includes(q);
          const filteredChildren = filterTree(node.children);
          if (matches || filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
          }
          return null;
        })
        .filter(Boolean) as CategoryNode[];
    };
    return filterTree(categories);
  }, [categories, search]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreateDialog = (parentId?: string) => {
    setEditingCategory(null);
    setForm({
      ...defaultForm,
      parent_id: parentId ?? "",
      sort_order: 0,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (cat: CategoryNode) => {
    setEditingCategory(cat);
    setForm({
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon ?? "",
      parent_id: cat.parent_id ?? "",
      sort_order: cat.sort_order,
      description: cat.description ?? "",
      is_active: cat.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error(t("velcenter.categories.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim() || form.name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-"),
        icon: form.icon.trim() || null,
        parent_id: form.parent_id || null,
        sort_order: form.sort_order,
        description: form.description.trim() || null,
        is_active: form.is_active,
      };

      if (editingCategory) {
        await api.centerAdmin.updateCategory({ categoryId: editingCategory.id, ...payload });
        toast.success(t("velcenter.categories.updateSuccess"));
      } else {
        await api.centerAdmin.createCategory(payload);
        toast.success(t("velcenter.categories.addSuccess"));
      }
      setDialogOpen(false);
      void loadCategories();
    } catch (err: any) {
      toast.error(err?.message || t("velcenter.common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await api.centerAdmin.deleteCategory({ categoryId: deleteConfirm.id });
      toast.success(t("velcenter.categories.deleteSuccess"));
      setDeleteConfirm(null);
      void loadCategories();
    } catch (err: any) {
      toast.error(err?.message || t("velcenter.categories.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (cat: CategoryNode) => {
    try {
      await api.centerAdmin.updateCategory({
        categoryId: cat.id,
        is_active: !cat.is_active,
      });
      toast.success(cat.is_active ? t("velcenter.categories.deactivateSuccess") : t("velcenter.categories.activateSuccess"));
      void loadCategories();
    } catch (err: any) {
      toast.error(err?.message || t("velcenter.common.error"));
    }
  };

  // Count totals
  const totalCount = useMemo(() => {
    const countAll = (nodes: CategoryNode[]): number =>
      nodes.reduce((sum, n) => sum + 1 + countAll(n.children), 0);
    return countAll(categories);
  }, [categories]);

  const activeCount = useMemo(() => {
    const countActive = (nodes: CategoryNode[]): number =>
      nodes.reduce((sum, n) => sum + (n.is_active ? 1 : 0) + countActive(n.children), 0);
    return countActive(categories);
  }, [categories]);

  // Flatten categories for parent selector
  const flatCategories = useMemo(() => {
    const flat: { id: string; name: string; depth: number }[] = [];
    const walk = (nodes: CategoryNode[], depth = 0) => {
      for (const n of nodes) {
        flat.push({ id: n.id, name: "  ".repeat(depth) + n.name, depth });
        walk(n.children, depth + 1);
      }
    };
    walk(categories);
    return flat;
  }, [categories]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">{t("velcenter.categories.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertCircle className="size-8 text-red-400" />
        <p className="text-sm text-slate-600">{t("velcenter.categories.loadFailed")}</p>
        <Button variant="outline" size="sm" onClick={() => void loadCategories()}>
          {t("velcenter.common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <FolderTree className="size-5 text-[#10B981]" />
            {t("velcenter.categories.title")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t("velcenter.categories.totalCount", { total: totalCount, active: activeCount })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("velcenter.categories.searchPlaceholder")}
              className="w-48 pl-9 text-sm"
            />
          </div>
          <Button onClick={() => openCreateDialog()} className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600">
            <Plus className="size-4" />
            {t("velcenter.categories.addButton")}
          </Button>
        </div>
      </div>

      {/* Category Tree */}
      <div className="rounded-xl border border-slate-200 bg-white">
        {filteredCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Package className="size-8 text-slate-300" />
            <p className="text-sm text-slate-500">
              {search ? t("velcenter.categories.searchEmpty") : t("velcenter.categories.empty")}
            </p>
            {!search && (
              <Button variant="outline" size="sm" onClick={() => openCreateDialog()}>
                <Plus className="mr-1 size-3" />
                {t("velcenter.categories.createFirst")}
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredCategories.map((cat) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                depth={0}
                expandedIds={expandedIds}
                onToggle={toggleExpand}
                onEdit={openEditDialog}
                onDelete={setDeleteConfirm}
                onToggleActive={handleToggleActive}
                onAddChild={openCreateDialog}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCategory ? t("velcenter.categories.editTitle") : t("velcenter.categories.createTitle")}</DialogTitle>
            <DialogDescription>
              {editingCategory ? t("velcenter.categories.editDesc", { name: editingCategory.name }) : t("velcenter.categories.createDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label>{t("velcenter.categories.formNameRequired")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="เช่น อิเล็กทรอนิกส์"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Slug (URL)</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="auto-generated"
                />
              </div>
              <div className="grid gap-2">
                <Label>ไอคอน</Label>
                
                {/* Lucide Icon Picker - Primary method */}
                <div>
                  <LucideIconPicker
                    value={form.icon}
                    onChange={(name) => setForm((p) => ({ ...p, icon: name }))}
                    placeholder="พิมพ์ชื่อไอคอน เช่น camera, store, package..."
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    ใช้ชื่อไอคอน Lucide (เช่น camera, store, package, shopping-bag, truck, heart, star)
                    · ดูชื่อทั้งหมดที่ <a href="https://lucide.dev/icons/" target="_blank" rel="noopener" className="text-emerald-600 hover:underline">lucide.dev/icons</a>
                  </p>

                  {/* Icon preview when selected */}
                  {form.icon && (
                    <div className="mt-2 p-2 rounded-[10px] border border-emerald-200 bg-emerald-50">
                      <p className="text-[11px] text-emerald-700 font-medium">ไอคอนที่เลือก:</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-[8px] border border-emerald-200 bg-white">
                          {(() => {
                            const pascal = form.icon.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                            const IconComp = (window as any).__lucideIcons?.[pascal];
                            if (IconComp) return <IconComp className="size-6 text-emerald-600" strokeWidth={2} />;
                            return (
                              <span className="inline-flex items-center justify-center w-10 h-10 rounded-[8px] bg-emerald-100 text-[10px] font-bold text-emerald-700">
                                {form.icon.slice(0, 2).toUpperCase()}
                              </span>
                            );
                          })()}
                        </span>
                        <span className="text-sm font-medium text-emerald-800">{form.icon}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid min-w-0 gap-2">
                <Label>หมวดหมู่แม่</Label>
                <Select
                  value={form.parent_id || "__root__"}
                  onValueChange={(value) =>
                    setForm((p) => ({ ...p, parent_id: value === "__root__" ? "" : value }))
                  }
                >
                  <SelectTrigger className="w-full min-w-0 truncate rounded-lg border-slate-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root__">ไม่มี (หมวดหมู่หลัก)</SelectItem>
                    {flatCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {"\u00a0\u00a0".repeat(c.depth)}
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 gap-2">
                <Label>ลำดับ</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) }))}
                  className="w-full min-w-0"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>คำอธิบาย</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="คำอธิบายหมวดหมู่ (ไม่บังคับ)"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="rounded"
                id="cat-active"
              />
              <Label htmlFor="cat-active" className="cursor-pointer">
                เปิดใช้งาน
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving} className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingCategory ? "บันทึก" : "สร้าง"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ยืนยันการลบ</DialogTitle>
            <DialogDescription>
              ต้องการลบหมวดหมู่ "{deleteConfirm?.name}" ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="gap-1.5"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              ลบ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Category Row Component ──────────────────────────────────────────
function CategoryRow({
  category,
  depth,
  expandedIds,
  onToggle,
  onEdit,
  onDelete,
  onToggleActive,
  onAddChild,
}: {
  category: CategoryNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (cat: CategoryNode) => void;
  onDelete: (cat: CategoryNode) => void;
  onToggleActive: (cat: CategoryNode) => void;
  onAddChild: (parentId: string) => void;
}) {
  const hasChildren = category.children.length > 0;
  const isExpanded = expandedIds.has(category.id);

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-4 py-3 transition-colors hover:bg-slate-50 ${
          !category.is_active ? "opacity-60" : ""
        }`}
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={() => onToggle(category.id)}
            className="shrink-0 rounded p-0.5 hover:bg-slate-200"
          >
            {isExpanded ? (
              <ChevronDown className="size-4 text-slate-500" />
            ) : (
              <ChevronRight className="size-4 text-slate-500" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Name + slug */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {category.icon ? (
              category.icon.startsWith("http") || category.icon.startsWith("data:") ? (
                <img src={category.icon} alt="" className="size-5 rounded object-cover" />
              ) : (
                <span className="size-5 flex items-center justify-center text-emerald-600">
                  {(() => {
                    const pascal = category.icon!.replace(
                      /-([a-z])/g,
                      (_, c) => c.toUpperCase()
                    );
                    const IconComp = (window as any).__lucideIcons?.[pascal];
                    if (IconComp) return <IconComp className="size-4" strokeWidth={2} />;
                    return (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-100 text-[8px] font-bold text-emerald-700">
                        {category.icon!.slice(0, 2).toUpperCase()}
                      </span>
                    );
                  })()}
                </span>
              )
            ) : Number(category.sort_order) > 0 && (
              <span className="size-5" />
            )}
            <span className="truncate text-sm font-medium text-slate-900">{category.display_name ?? category.name}</span>
          </div>
          <span className="ml-2 text-xs text-slate-400">/{category.slug}</span>
        </div>

        {/* Product count */}
        {(category.product_count ?? 0) > 0 && (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Package className="size-3" />
            {category.product_count}
          </Badge>
        )}

        {/* Active badge */}
        <Badge
          variant={category.is_active ? "default" : "outline"}
          className={`text-xs ${category.is_active ? "bg-emerald-100 text-emerald-700" : "text-slate-400"}`}
        >
          {category.is_active ? "ใช้งาน" : "ปิด"}
        </Badge>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-400 hover:text-slate-700"
            onClick={() => onAddChild(category.id)}
            title="เพิ่มหมวดย่อย"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-400 hover:text-slate-700"
            onClick={() => onToggleActive(category)}
            title={category.is_active ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}
          >
            {category.is_active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-400 hover:text-blue-600"
            onClick={() => onEdit(category)}
            title="แก้ไข"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-400 hover:text-red-600"
            onClick={() => onDelete(category)}
            title="ลบ"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="divide-y divide-slate-100">
          {category.children.map((child) => (
            <CategoryRow
              key={child.id}
              category={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleActive={onToggleActive}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}
