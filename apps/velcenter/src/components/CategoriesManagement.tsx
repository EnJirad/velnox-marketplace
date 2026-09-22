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
import { useCallback, useEffect, useMemo, useState } from "react";
import { onCenterEvent } from "../lib/center-events";
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
} from "lucide-react";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Badge } from "@velnox/shared/components/ui/badge";
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
      toast.error("กรุณาใส่ชื่อหมวดหมู่");
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
        toast.success("อัปเดตหมวดหมู่สำเร็จ");
      } else {
        await api.centerAdmin.createCategory(payload);
        toast.success("สร้างหมวดหมู่สำเร็จ");
      }
      setDialogOpen(false);
      void loadCategories();
    } catch (err: any) {
      toast.error(err?.message || "เกิดข้อผิดพลาด");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await api.centerAdmin.deleteCategory({ categoryId: deleteConfirm.id });
      toast.success("ลบหมวดหมู่สำเร็จ");
      setDeleteConfirm(null);
      void loadCategories();
    } catch (err: any) {
      toast.error(err?.message || "ไม่สามารถลบหมวดหมู่ได้");
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
      toast.success(cat.is_active ? "ปิดการใช้งานหมวดหมู่" : "เปิดการใช้งานหมวดหมู่");
      void loadCategories();
    } catch (err: any) {
      toast.error(err?.message || "เกิดข้อผิดพลาด");
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
        <span className="ml-2 text-sm text-slate-500">กำลังโหลดหมวดหมู่...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertCircle className="size-8 text-red-400" />
        <p className="text-sm text-slate-600">โหลดหมวดหมู่ไม่สำเร็จ</p>
        <Button variant="outline" size="sm" onClick={() => void loadCategories()}>
          ลองใหม่
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
            จัดการหมวดหมู่สินค้า
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ทั้งหมด {totalCount} หมวด ({activeCount} ใช้งาน)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาหมวดหมู่..."
              className="w-48 pl-9 text-sm"
            />
          </div>
          <Button onClick={() => openCreateDialog()} className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600">
            <Plus className="size-4" />
            เพิ่มหมวดหมู่
          </Button>
        </div>
      </div>

      {/* Category Tree */}
      <div className="rounded-xl border border-slate-200 bg-white">
        {filteredCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Package className="size-8 text-slate-300" />
            <p className="text-sm text-slate-500">
              {search ? "ไม่พบหมวดหมู่ที่ค้นหา" : "ยังไม่มีหมวดหมู่"}
            </p>
            {!search && (
              <Button variant="outline" size="sm" onClick={() => openCreateDialog()}>
                <Plus className="mr-1 size-3" />
                สร้างหมวดหมู่แรก
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
            <DialogTitle>{editingCategory ? "แก้ไขหมวดหมู่" : "สร้างหมวดหมู่ใหม่"}</DialogTitle>
            <DialogDescription>
              {editingCategory ? `แก้ไข "${editingCategory.name}"` : "เพิ่มหมวดหมู่ย่อยหรือหมวดหมู่หลัก"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-2">
              <Label>ชื่อหมวดหมู่ *</Label>
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
                <Label>Icon</Label>
                <Input
                  value={form.icon}
                  onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                  placeholder="lucide icon name"
                />
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid min-w-0 gap-2">
                <Label>หมวดหมู่แม่</Label>
                <select
                  value={form.parent_id}
                  onChange={(e) => setForm((p) => ({ ...p, parent_id: e.target.value }))}
                  className="w-full min-w-0 max-w-full truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">ไม่มี (หมวดหมู่หลัก)</option>
                  {flatCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {"  ".repeat(c.depth)}{c.name}
                    </option>
                  ))}
                </select>
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
          <span className="text-sm font-medium text-slate-900">{category.display_name ?? category.name}</span>
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
