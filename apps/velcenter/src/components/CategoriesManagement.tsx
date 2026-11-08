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
 * - Custom PNG/SVG icon uploads only
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
  Copy,
  Check,
  RefreshCw,
  Upload,
  Image,
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
  image_url: string;
  parent_id: string;
  sort_order: number;
  description: string;
  is_active: boolean;
  slugManuallyEdited: boolean;
};

const defaultForm: CategoryForm = {
  name: "",
  slug: "",
  image_url: "",
  parent_id: "",
  sort_order: 0,
  description: "",
  is_active: true,
  slugManuallyEdited: false,
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Slugify helper - consistent with backend
  const slugifyCategory = (text: string): string => {
    // Thai character to Latin transliteration map
    const thaiMap: Record<string, string> = {
      'ก': 'k', 'ข': 'kh', 'ฃ': 'kh', 'ค': 'kh', 'ฅ': 'kh', 'ฆ': 'kh',
      'ง': 'ng', 'จ': 'ch', 'ฉ': 'ch', 'ช': 'ch', 'ซ': 's', 'ฌ': 'ch',
      'ญ': 'y', 'ฎ': 'd', 'ฏ': 't', 'ฐ': 'th', 'ฑ': 'th', 'ฒ': 'th',
      'ณ': 'n', 'ด': 'd', 'ต': 't', 'ถ': 'th', 'ท': 'th', 'ธ': 'th',
      'น': 'n', 'บ': 'b', 'ป': 'p', 'ผ': 'ph', 'ฝ': 'f', 'พ': 'ph',
      'ฟ': 'f', 'ภ': 'ph', 'ม': 'm', 'ย': 'y', 'ร': 'r', 'ฤ': 'ru',
      'ล': 'l', 'ฦ': 'lu', 'ว': 'w', 'ศ': 's', 'ษ': 's', 'ส': 's',
      'ห': 'h', 'ฬ': 'l', 'อ': 'o', 'ฮ': 'h', 'ะ': 'a', 'า': 'a',
      'ิ': 'i', 'ี': 'i', 'ึ': 'ue', 'ื': 'ue', 'ุ': 'u', 'ู': 'u',
      'เ': 'e', 'แ': 'ae', 'โ': 'o', 'ใ': 'ai', 'ไ': 'ai', 'ำ': 'am',
      '่': '', '้': '', '๊': '', '๋': '', '์': '', '็': '',
      '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
    };

    // Burmese character to Latin transliteration map
    const burmeseMap: Record<string, string> = {
      'က': 'ka', 'ခ': 'kha', 'ဂ': 'ga', 'ဃ': 'gha', 'င': 'nga',
      'စ': 'sa', 'ဆ': 'hsa', 'ဇ': 'za', 'ဈ': 'zha', 'ည': 'nya',
      'ဋ': 'ta', 'ဌ': 'tha', 'ဍ': 'da', 'ဎ': 'dha', 'ဏ': 'na',
      'တ': 'ta', 'ထ': 'tha', 'ဒ': 'da', 'ဓ': 'dha', 'န': 'na',
      'ပ': 'pa', 'ဖ': 'pha', 'ဗ': 'ba', 'ဘ': 'bha', 'မ': 'ma',
      'ယ': 'ya', 'ရ': 'ra', 'လ': 'la', 'ဝ': 'wa', 'သ': 'tha',
      'ဟ': 'ha', 'ဠ': 'la', 'အ': 'a', 'ဢ': 'a', 'ဣ': 'i',
      'ဤ': 'i', 'ဥ': 'u', 'ဦ': 'u', 'ဧ': 'e', 'ဨ': 'e', 'ဩ': 'o',
      'ဪ': 'o', 'အာ': 'a', 'အား': 'a', 'အိ': 'i', 'အီ': 'i',
      'အု': 'u', 'အူ': 'u', 'အေ': 'e', 'အေး': 'e', 'အို': 'o', 'အော့': 'o',
      '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4', '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9',
    };

    let result = text;

    // Transliterate Thai characters
    result = result.split('').map(char => thaiMap[char] || char).join('');

    // Transliterate Burmese characters
    result = result.split('').map(char => burmeseMap[char] || char).join('');

    // Now slugify the transliterated text
    return result
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 120);
  };

  // Handle custom icon upload to R2 (PNG/SVG only)
  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type (PNG/SVG only)
    const allowedTypes = ["image/png", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      setUploadError(t("velcenter.categories.formIconUploadErrorType"));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t("velcenter.categories.formIconUploadErrorSize"));
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // Get presigned URL for category icon upload
      const presignRes = await fetch(`${apiBaseUrl}/api/upload/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "category-icon",
          filename: file.name,
          contentType: file.type,
          categoryId: editingCategory?.id || "", // Send categoryId for existing categories
        }),
      });

      const presignData = await presignRes.json();
      if (!presignData.success) {
        throw new Error(presignData.error?.message || "Failed to get upload URL");
      }

      const { uploadUrl, publicUrl, objectKey } = presignData.data;

      // Upload file to R2
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error("Upload to storage failed");
      }

      // Confirm upload (if needed by the API)
      const confirmRes = await fetch(`${apiBaseUrl}/api/upload/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          purpose: "category-icon",
          objectKey: objectKey,
        }),
      });

      const confirmData = await confirmRes.json();
      if (!confirmData.success) {
        console.warn("Upload confirm warning:", confirmData.error);
      }

      // Set the image URL
      setForm((p) => ({ ...p, image_url: publicUrl }));
      toast.success(t("velcenter.categories.formIconUploadSuccess"));
    } catch (err: any) {
      setUploadError(err?.message || t("velcenter.categories.formIconUploadError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

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
      image_url: cat.image_url ?? "",
      parent_id: cat.parent_id ?? "",
      sort_order: cat.sort_order,
      description: cat.description ?? "",
      is_active: cat.is_active,
      slugManuallyEdited: false,
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
        image_url: form.image_url.trim() || null,
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
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 truncate">
            <FolderTree className="size-5 text-[#10B981] flex-shrink-0" />
            {t("velcenter.categories.title")}
          </h2>
          <p className="mt-1 text-sm text-slate-500 truncate">
            {t("velcenter.categories.totalCount", { total: totalCount, active: activeCount })}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("velcenter.categories.searchPlaceholder")}
              className="w-full pl-9 text-sm"
            />
          </div>
          <Button onClick={() => openCreateDialog()} className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600 w-full sm:w-auto">
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
        <DialogContent className="max-w-md max-h-[90vh] sm:max-h-none">
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
                onChange={(e) => {
                  const newName = e.target.value;
                  setForm((p) => {
                    // Auto-generate slug if it hasn't been manually edited
                    const wasAutoGenerated = p.slug === slugifyCategory(p.name);
                    return {
                      ...p,
                      name: newName,
                      slug: wasAutoGenerated ? slugifyCategory(newName) : p.slug,
                    };
                  });
                }}
                placeholder="เช่น อิเล็กทรอนิกส์"
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("velcenter.categories.formSlugLabel")}</Label>
              <div className="relative">
                <Input
                  value={form.slug}
                  onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value, slugManuallyEdited: true }))}
                  placeholder={t("velcenter.categories.formSlugPlaceholder")}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, slug: slugifyCategory(p.name), slugManuallyEdited: false }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600"
                  title={t("velcenter.categories.formSlugReset")}
                >
                  <RefreshCw className="size-4" />
                </button>
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                  <span>{t("velcenter.categories.formSlugPreview", { url: apiBaseUrl + "/category/" + (form.slug || "...") })}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(apiBaseUrl + "/category/" + form.slug)}
                    className="text-emerald-600 hover:underline text-[11px]"
                  >
                    {t("velcenter.categories.formSlugCopy")}
                  </button>
                </p>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("velcenter.categories.formIconLabel")}</Label>
              
              {/* Custom Icon Upload - PNG/SVG only */}
              <div>
                {form.image_url && (
                  <div className="mb-3 p-3 rounded-[10px] border border-emerald-200 bg-emerald-50">
                    <p className="text-[11px] text-emerald-700 font-medium">{t("velcenter.categories.formIconCurrent")}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="relative w-16 h-16 flex-shrink-0">
                        {form.image_url.toLowerCase().endsWith('.svg') ? (
                          <img src={form.image_url} alt="" className="w-full h-full object-contain rounded-[8px] border border-emerald-200 bg-white" />
                        ) : (
                          <img src={form.image_url} alt="" className="w-full h-full object-cover rounded-[8px] border border-emerald-200" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-emerald-800 truncate">{form.image_url}</p>
                        <div className="flex gap-2 mt-1">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(form.image_url)}
                            className="text-[11px] text-emerald-600 hover:underline"
                          >
                            {t("velcenter.categories.formIconCopyUrl")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm((p) => ({ ...p, image_url: '' }))}
                            className="text-[11px] text-red-600 hover:underline"
                          >
                            {t("velcenter.categories.formIconRemove")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  <label className="flex flex-col items-center justify-center gap-3 w-full h-32 border-2 border-dashed border-slate-200 rounded-[12px] cursor-pointer hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
                    <span className="flex items-center gap-2 text-sm text-slate-500">
                      <Upload className="size-4" />
                      {t("velcenter.categories.formIconDragDrop")}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/svg+xml"
                      onChange={handleIconUpload}
                      className="sr-only"
                      id="icon-upload"
                      ref={fileInputRef}
                      disabled={uploading}
                    />
                    <span className="text-sm text-emerald-600 font-medium underline">{t("velcenter.categories.formIconBrowse")}</span>
                  </label>
                  {uploading && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="size-4 animate-spin text-emerald-600" />
                      <span>{t("velcenter.categories.formIconUploading")}</span>
                    </div>
                  )}
                  {uploadError && (
                    <p className="text-sm text-red-600">{uploadError}</p>
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
        className={`flex items-center gap-2 px-4 py-2 transition-colors hover:bg-slate-50 ${
          !category.is_active ? "opacity-60" : ""
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={() => onToggle(category.id)}
            className="shrink-0 rounded p-0.5 hover:bg-slate-200 flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="size-4 text-slate-500" />
            ) : (
              <ChevronRight className="size-4 text-slate-500" />
            )}
          </button>
        ) : (
          <span className="w-5 flex-shrink-0" />
        )}

        {/* Name + slug + icon */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {category.image_url ? (
              category.image_url.startsWith("http") || category.image_url.startsWith("data:") ? (
                <img src={category.image_url} alt="" className="size-5 rounded object-cover flex-shrink-0" />
              ) : (
                <span className="size-5 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <Image className="size-4" />
                </span>
              )
            ) : Number(category.sort_order) > 0 && (
              <span className="size-5 flex-shrink-0" />
            )}
            <span className="truncate text-sm font-medium text-slate-900">{category.display_name ?? category.name}</span>
          </div>
          <span className="ml-2 text-xs text-slate-400 hidden sm:inline">/{category.slug}</span>
        </div>

        {/* Product count */}
        {(category.product_count ?? 0) > 0 && (
          <Badge variant="secondary" className="gap-1 text-xs flex-shrink-0">
            <Package className="size-3" />
            {category.product_count}
          </Badge>
        )}

        {/* Active badge */}
        <Badge
          variant={category.is_active ? "default" : "outline"}
          className={`text-xs ${category.is_active ? "bg-emerald-100 text-emerald-700" : "text-slate-400"} flex-shrink-0`}
        >
          {category.is_active ? "ใช้งาน" : "ปิด"}
        </Badge>

        {/* Actions - single row, no wrap */}
        <div className="flex items-center gap-1 flex-shrink-0">
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
