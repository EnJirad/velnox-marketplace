import { api } from "@velnox/shared/lib/api-routes";
import {
  PRODUCT_CATEGORY_META,
  type StoreProduct,
  type StoreProductCategory,
  type StoreShop,
} from "@velnox/shared/lib/commerce";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import { Switch } from "@velnox/shared/components/ui/switch";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { ImageUploader } from "@velnox/shared/components/seller/ImageUploader";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  Loader2,
  Store,
  Plus,
  X,
  ListOrdered,
  Tag,
  Pencil,
  Trash2,
  ImagePlus,
} from "lucide-react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shop: StoreShop;
  /** when provided, edits this product instead of creating a new one */
  product?: StoreProduct | null;
  onSaved?: (product: StoreProduct) => void;
}

interface InnerProps {
  shop: StoreShop;
  product: StoreProduct | null;
  onClose: () => void;
  onSaved?: (product: StoreProduct) => void;
}

// ─── Option Group / Value types ────────────────────────────────────────
interface OptionValueForm {
  id?: string; // existing server value
  value: string;
  label: string;
  imageUrl?: string | null; // option value image
}

interface OptionGroupForm {
  id?: string;
  name: string;
  displayType: string;
  values: OptionValueForm[];
}

interface AttributeForm {
  id?: string;
  name: string;
  value: string;
}

interface VariantRow {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock: number;
  status: string;
  optionLabels: string;
  imageUrl?: string | null;
}

/** Inline variant manager — generates and edits variants for a saved product. */
function VariantManager({ productId, price }: { productId: string; price: number }) {
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<{ price: string; stock: string; sku: string; status: string }>({ price: "", stock: "", sku: "", status: "active" });
  const [loaded, setLoaded] = useState(false);

  const baseUrl = import.meta.env.VITE_API_URL || "";

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants`, { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        const variantList = data.data ?? [];
        // Load first image for each variant
        const withImages = await Promise.all(variantList.map(async (v: VariantRow) => {
          try {
            const imgRes = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${v.id}/images`, { credentials: "include" });
            const imgData = await imgRes.json();
            const imgs = imgData.data ?? [];
            return { ...v, imageUrl: imgs[0]?.url ?? null };
          } catch { return v; }
        }));
        setVariants(withImages);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [productId, baseUrl]);

  useEffect(() => {
    if (!loaded) { fetchVariants(); setLoaded(true); }
  }, [loaded, fetchVariants]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`สร้าง ${data.data?.variants?.length ?? 0} variants สำเร็จ`);
        await fetchVariants();
      } else {
        toast.error(data.error?.message || "สร้าง variant ไม่สำเร็จ");
      }
    } catch { toast.error("สร้าง variant ไม่สำเร็จ"); }
    setGenerating(false);
  };

  const startEdit = (v: VariantRow) => {
    setEditingId(v.id);
    setEditFields({ price: String(v.price), stock: String(v.stock), sku: v.sku ?? "", status: v.status });
  };

  const saveEdit = async (variantId: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          price: Number(editFields.price),
          stock: Number(editFields.stock),
          sku: editFields.sku || null,
          status: editFields.status,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingId(null);
        await fetchVariants();
        toast.success("บันทึก variant แล้ว");
      } else {
        toast.error(data.error?.message || "บันทึกไม่สำเร็จ");
      }
    } catch { toast.error("บันทึกไม่สำเร็จ"); }
  };

  const handleDelete = async (variantId: string) => {
    try {
      await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${variantId}`, {
        method: "DELETE",
        credentials: "include",
      });
      await fetchVariants();
    } catch { /* best effort */ }
  };

  const [uploadingVariantImage, setUploadingVariantImage] = useState<string | null>(null);

  const handleVariantImageUpload = async (variantId: string, file: File) => {
    const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!ACCEPT.includes(file.type)) { toast.error("ไฟล์ไม่ใช่รูปภาพที่รองรับ"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("ไฟล์ใหญ่เกิน 10 MB"); return; }

    setUploadingVariantImage(variantId);
    try {
      // 1. Upload image via existing product image upload intent (reuse R2 flow)
      const intentRes = await fetch(`${baseUrl}/api/seller/products/image-upload-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ productId, filename: file.name, mimeType: file.type }),
      });
      const intentData = await intentRes.json();
      if (!intentData.success) throw new Error(intentData.error?.message || "Failed to get upload URL");

      // 2. Upload to R2
      const uploadRes = await fetch(intentData.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);

      // 3. Save variant image
      const saveRes = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${variantId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: intentData.data.cdnUrl, alt: file.name, storageKey: intentData.data.objectKey }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) throw new Error(saveData.error?.message || "Failed to save variant image");

      await fetchVariants();
      toast.success("อัปโหลดรูป variant สำเร็จ");
    } catch (err) {
      console.error("Variant image upload error:", err);
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploadingVariantImage(null);
    }
  };

  if (variants.length === 0 && !loading) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3">
        <Button
          type="button"
          variant="outline"
          className="w-full gap-1.5 border-dashed border-[#10B981] text-sm text-[#10B981] hover:bg-[#ECFDF5]"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : <ListOrdered className="size-4" />}
          สร้าง Variants จากตัวเลือก
        </Button>
        <p className="mt-1 text-[11px] text-slate-400">สร้าง combination ของตัวเลือกอัตโนมัติ เช่น สีแดง+S, สีแดง+M</p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">Variants ({variants.length})</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs text-[#10B981]" onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          สร้างใหม่
        </Button>
      </div>
      <div className="mt-2 space-y-1.5">
        {variants.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs">
            {editingId === v.id ? (
              <>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{v.name}</span>
                <Input value={editFields.price} onChange={(e) => setEditFields((f) => ({ ...f, price: e.target.value }))} type="number" className="h-7 w-20 text-xs" placeholder="ราคา" />
                <Input value={editFields.stock} onChange={(e) => setEditFields((f) => ({ ...f, stock: e.target.value }))} type="number" className="h-7 w-16 text-xs" placeholder="stock" />
                <Input value={editFields.sku} onChange={(e) => setEditFields((f) => ({ ...f, sku: e.target.value }))} className="h-7 w-20 text-xs" placeholder="SKU" />
                <Button type="button" size="sm" className="h-7 text-xs" onClick={() => saveEdit(v.id)}>บันทึก</Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>ยกเลิก</Button>
              </>
            ) : (
              <>
                {/* Variant image thumbnail */}
                <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded border border-slate-200 bg-slate-50">
                  {v.imageUrl ? (
                    <img src={v.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center">
                      {uploadingVariantImage === v.id ? (
                        <Loader2 className="size-3 animate-spin text-slate-300" />
                      ) : (
                        <ImagePlus className="size-3 text-slate-300" />
                      )}
                    </span>
                  )}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVariantImageUpload(v.id, f); e.target.value = ""; }}
                  />
                </label>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{v.name}</span>
                <span className="shrink-0 tabular-nums text-slate-600">฿{v.price}</span>
                <span className={`shrink-0 tabular-nums ${v.stock <= 0 ? "text-red-500" : v.stock <= 5 ? "text-amber-600" : "text-slate-600"}`}>{v.stock} ชิ้น</span>
                {v.sku && <span className="shrink-0 font-mono text-[10px] text-slate-400">{v.sku}</span>}
                <Badge className={`shrink-0 text-[10px] ${v.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{v.status}</Badge>
                <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-slate-700" onClick={() => startEdit(v)} aria-label="แก้ไข">
                  <Pencil className="size-3" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-red-500" onClick={() => handleDelete(v.id)} aria-label="ลบ">
                  <Trash2 className="size-3" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const defaultForm = {
  name: "",
  category: "general" as StoreProductCategory,
  unit: "ชิ้น",
  price: "",
  description: "",
  supplier: "",
  stock: "",
  reorderLevel: "",
  published: false,
};

function ProductFormInner({ shop, product, onClose, onSaved }: InnerProps) {
  const createProduct = useAction(api.commerce.createProductAction);
  const updateProduct = useAction(api.commerce.updateProductAction);
  const setStock = useAction(api.commerce.setStockAction);
  const setReorderLevel = useAction(api.commerce.setReorderLevelAction);

  const [form, setForm] = useState<typeof defaultForm>(() =>
    product
      ? {
          name: product.name,
          category: product.category,
          unit: product.unit,
          price: product.price > 0 ? String(product.price) : "",
          description: product.description ?? "",
          supplier: product.supplier ?? "",
          stock: String(product.inventory?.quantity ?? 0),
          reorderLevel: String(product.inventory?.reorderLevel ?? 0),
          published: product.status === "published",
        }
      : defaultForm,
  );
  const [current, setCurrent] = useState<StoreProduct | null>(product ?? null);
  const [saving, setSaving] = useState(false);
  const isEdit = product !== null;

  // ─── Option groups state ──────────────────────────────────────────────
  const [optionGroups, setOptionGroups] = useState<OptionGroupForm[]>([]);
  const [attributes, setAttributes] = useState<AttributeForm[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // Load existing options when editing
  useEffect(() => {
    if (!current?.id || optionsLoaded) return;
    const loadOptions = async () => {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${baseUrl}/api/seller/products/${current.id}/options`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data) {
          const groups = (data.data.optionGroups ?? []).map((g: any) => ({
            id: g.id,
            name: g.name,
            displayType: g.displayType ?? "text",
            values: (g.values ?? []).map((v: any) => ({
              id: v.id,
              value: v.value,
              label: v.label ?? v.value,
              imageUrl: v.imageUrl ?? null,
            })),
          }));
          setOptionGroups(groups);
          setAttributes((data.data.attributes ?? []).map((a: any) => ({
            id: a.id,
            name: a.name,
            value: a.value,
          })));
        }
      } catch { /* ignore — options may not exist yet */ }
      setOptionsLoaded(true);
    };
    void loadOptions();
  }, [current?.id, optionsLoaded]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ─── Option group helpers ─────────────────────────────────────────────
  const addOptionGroup = () => {
    setOptionGroups((prev) => [...prev, { name: "", displayType: "text", values: [{ value: "", label: "" }] }]);
  };

  const removeOptionGroup = (index: number) => {
    setOptionGroups((prev) => prev.filter((_, i) => i !== index));
  };

  const updateGroupName = (index: number, name: string) => {
    setOptionGroups((prev) => prev.map((g, i) => i === index ? { ...g, name } : g));
  };

  const addOptionValue = (groupIndex: number) => {
    setOptionGroups((prev) => prev.map((g, i) =>
      i === groupIndex ? { ...g, values: [...g.values, { value: "", label: "" }] } : g
    ));
  };

  const removeOptionValue = (groupIndex: number, valueIndex: number) => {
    setOptionGroups((prev) => prev.map((g, i) =>
      i === groupIndex ? { ...g, values: g.values.filter((_, vi) => vi !== valueIndex) } : g
    ));
  };

  const updateOptionValue = (groupIndex: number, valueIndex: number, value: string) => {
    setOptionGroups((prev) => prev.map((g, i) =>
      i === groupIndex
        ? { ...g, values: g.values.map((v, vi) => vi === valueIndex ? { ...v, value, label: value } : v) }
        : g
    ));
  };

  // ─── Option value image upload ───────────────────────────────────────
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);

  const handleOptionValueImageUpload = async (groupIndex: number, valueIndex: number, file: File) => {
    if (!current?.id) return;
    const val = optionGroups[groupIndex]?.values[valueIndex];
    if (!val?.id) { toast.error("กรุณาบันทึกตัวเลือกก่อนเพิ่มรูป"); return; }

    const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!ACCEPT.includes(file.type)) { toast.error("ไฟล์ไม่ใช่รูปภาพที่รองรับ"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("ไฟล์ใหญ่เกิน 10 MB"); return; }

    const baseUrl = import.meta.env.VITE_API_URL || "";
    const uploadKey = `${groupIndex}-${valueIndex}`;
    setUploadingImage(uploadKey);
    try {
      // 1. Get signed R2 URL
      const intentRes = await fetch(`${baseUrl}/api/seller/products/${current.id}/option-values/${val.id}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ filename: file.name, mimeType: file.type }),
      });
      const intentData = await intentRes.json();
      if (!intentData.success) throw new Error(intentData.error?.message || "Failed to get upload URL");

      // 2. Upload to R2 directly
      const uploadRes = await fetch(intentData.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);

      // 3. Save image URL to option value
      const saveRes = await fetch(`${baseUrl}/api/seller/products/${current.id}/option-values/${val.id}/save-image`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ imageUrl: intentData.data.cdnUrl }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) throw new Error(saveData.error?.message || "Failed to save image");

      // 4. Update local state
      setOptionGroups((prev) => prev.map((g, gi) =>
        gi === groupIndex ? { ...g, values: g.values.map((v, vi) =>
          vi === valueIndex ? { ...v, imageUrl: intentData.data.cdnUrl } : v
        ) } : g
      ));
      toast.success("อัปโหลดรูปสำเร็จ");
    } catch (err) {
      console.error("Option image upload error:", err);
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploadingImage(null);
    }
  };

  const handleOptionValueImageDelete = async (groupIndex: number, valueIndex: number) => {
    if (!current?.id) return;
    const val = optionGroups[groupIndex]?.values[valueIndex];
    if (!val?.id) return;

    const baseUrl = import.meta.env.VITE_API_URL || "";
    try {
      await fetch(`${baseUrl}/api/seller/products/${current.id}/option-values/${val.id}/image`, {
        method: "DELETE",
        credentials: "include",
      });
      setOptionGroups((prev) => prev.map((g, gi) =>
        gi === groupIndex ? { ...g, values: g.values.map((v, vi) =>
          vi === valueIndex ? { ...v, imageUrl: null } : v
        ) } : g
      ));
      toast.success("ลบรูปแล้ว");
    } catch { /* best effort */ }
  };

  // ─── Attribute helpers ────────────────────────────────────────────────
  const addAttribute = () => {
    setAttributes((prev) => [...prev, { name: "", value: "" }]);
  };

  const removeAttribute = (index: number) => {
    setAttributes((prev) => prev.filter((_, i) => i !== index));
  };

  const updateAttribute = (index: number, field: "name" | "value", val: string) => {
    setAttributes((prev) => prev.map((a, i) => i === index ? { ...a, [field]: val } : a));
  };

  // ─── Save options to server ───────────────────────────────────────────
  const saveOptions = useCallback(async (productId: string) => {
    const baseUrl = import.meta.env.VITE_API_URL || "";

    // Save option groups
    for (const group of optionGroups) {
      if (!group.name.trim()) continue;

      let groupId = group.id;
      if (groupId) {
        // Update existing group name
        try {
          await fetch(`${baseUrl}/api/seller/products/${productId}/option-groups/${groupId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name: group.name.trim() }),
          });
        } catch { /* best effort */ }
      } else {
        // Create new group
        try {
          const res = await fetch(`${baseUrl}/api/seller/products/${productId}/option-groups`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ name: group.name.trim(), displayType: group.displayType }),
          });
          const data = await res.json();
          if (data.success && data.data?.id) groupId = data.data.id;
        } catch { continue; }
      }

      if (!groupId) continue;

      // Save option values
      for (const val of group.values) {
        if (!val.value.trim()) continue;
        if (val.id) continue; // existing value, skip
        try {
          await fetch(`${baseUrl}/api/seller/products/${productId}/option-groups/${groupId}/values`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ value: val.value.trim(), label: val.label || val.value.trim() }),
          });
        } catch { /* best effort */ }
      }
    }

    // Save attributes
    for (const attr of attributes) {
      if (!attr.name.trim() || !attr.value.trim()) continue;
      if (attr.id) continue; // existing, skip
      try {
        await fetch(`${baseUrl}/api/seller/products/${productId}/attributes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: attr.name.trim(), value: attr.value.trim() }),
        });
      } catch { /* best effort */ }
    }
  }, [optionGroups, attributes]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("กรุณากรอกชื่อสินค้า");
      return;
    }
    const price = Number(form.price);
    if (!form.price || !Number.isFinite(price) || price <= 0) {
      toast.error("กรุณากรอกราคาให้ถูกต้อง (มากกว่า 0)");
      return;
    }
    if (form.published) {
      const stock = Number(form.stock);
      if (!Number.isFinite(stock) || stock < 0) {
        toast.error("กรุณากรอกจำนวนสต็อกให้ถูกต้อง");
        return;
      }
    }

    setSaving(true);
    try {
      if (current) {
        const updated = await updateProduct({
          productId: current.id,
          name: form.name,
          category: form.category,
          unit: form.unit.trim() || "ชิ้น",
          price,
          description: form.description || undefined,
          supplier: form.supplier || undefined,
          status: form.published ? "published" : "draft",
        });
        if (updated) {
          if (form.stock !== "") await setStock({ productId: current.id, quantity: Math.max(0, Number(form.stock)) });
          if (form.reorderLevel !== "") await setReorderLevel({ productId: current.id, reorderLevel: Math.max(0, Number(form.reorderLevel)) });
          await saveOptions(current.id);
          toast.success("บันทึกสินค้าแล้ว");
          setCurrent(updated);
          onSaved?.(updated);
        }
      } else {
        const created = await createProduct({
          shopId: shop.id,
          name: form.name,
          category: form.category,
          unit: form.unit.trim() || "ชิ้น",
          price,
          description: form.description || undefined,
          supplier: form.supplier || undefined,
          status: form.published ? "published" : "draft",
          initialStock: form.stock ? Math.max(0, Number(form.stock)) : 0,
          reorderLevel: form.reorderLevel ? Math.max(0, Number(form.reorderLevel)) : undefined,
        });
        if (created) {
          await saveOptions(created.id);
          toast.success("เพิ่มสินค้าแล้ว — อัปโหลดรูปได้เลย 🖼️");
          setCurrent(created);
          onSaved?.(created);
        }
      }
    } catch (error) {
      console.error("Product save error:", error);
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSaving(false);
    }
  };

  const hasOptions = optionGroups.some((g) => g.name.trim() && g.values.some((v) => v.value.trim()));

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{current ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</DialogTitle>
        <DialogDescription>
          จัดการสินค้าของร้าน {shop.name} — ราคา สต็อก ตัวเลือก และรูปภาพ
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="p-name">ชื่อสินค้า *</Label>
          <Input
            id="p-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="เช่น แชมพูสมุนไพร ขนาด 300 มล."
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>หมวดหมู่</Label>
            <Select value={form.category} onValueChange={(v) => set("category", v as StoreProductCategory)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="เลือกหมวดหมู่" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRODUCT_CATEGORY_META).map(([key, meta]) => (
                  <SelectItem key={key} value={key}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-unit">หน่วย</Label>
            <Input
              id="p-unit"
              value={form.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="ชิ้น, กล่อง, ถุง"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="p-price">ราคาขาย (บาท) *</Label>
            <Input
              id="p-price"
              type="number"
              min="0"
              step="0.5"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              placeholder="เช่น 45"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-supplier">ซัพพลายเออร์ (ไม่บังคับ)</Label>
            <Input
              id="p-supplier"
              value={form.supplier}
              onChange={(e) => set("supplier", e.target.value)}
              placeholder="ชื่อร้านค้าส่ง"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="p-stock">สต็อก (จำนวน)</Label>
            <Input
              id="p-stock"
              type="number"
              min="0"
              step="1"
              value={form.stock}
              onChange={(e) => set("stock", e.target.value)}
              placeholder="เช่น 100"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-reorder">จุดสั่งซื้อซ้ำ</Label>
            <Input
              id="p-reorder"
              type="number"
              min="0"
              step="1"
              value={form.reorderLevel}
              onChange={(e) => set("reorderLevel", e.target.value)}
              placeholder="เช่น 20"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="p-desc">คำอธิบายสินค้า (แสดงที่หน้าร้าน)</Label>
          <Textarea
            id="p-desc"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="เช่น สูตรคลาสสิก ปราศจากสารกันเสีย"
            rows={2}
          />
        </div>

        {/* ═══ Option Groups ═══════════════════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <ListOrdered className="size-4 text-[#10B981]" />
            <h3 className="text-sm font-semibold text-slate-900">ตัวเลือกสินค้า (Option Groups)</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            สร้างตัวเลือกสินค้า เช่น สี, ขนาด, รสชาติ — ลูกค้าจะเลือกตัวเลือกเหล่านี้ก่อนเพิ่มลงตะกร้า
          </p>

          <div className="mt-3 space-y-3">
            {optionGroups.map((group, gi) => (
              <div key={gi} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={group.name}
                    onChange={(e) => updateGroupName(gi, e.target.value)}
                    placeholder="เช่น สี, ขนาด, รสชาติ"
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-red-400 hover:text-red-600"
                    onClick={() => removeOptionGroup(gi)}
                    aria-label="ลบกลุ่มตัวเลือก"
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                <div className="mt-2 space-y-2">
                  {group.values.map((val, vi) => (
                    <div key={vi} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                      {/* Image preview + upload */}
                      <div className="relative size-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                        {val.imageUrl ? (
                          <>
                            <img src={val.imageUrl} alt={val.value} className="size-full object-cover" />
                            <button
                              type="button"
                              className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                              onClick={() => handleOptionValueImageDelete(gi, vi)}
                              aria-label="ลบรูป"
                            >
                              <X className="size-2.5" />
                            </button>
                          </>
                        ) : (
                          <label className="flex size-full cursor-pointer items-center justify-center text-slate-300 hover:text-[#10B981]">
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/avif"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleOptionValueImageUpload(gi, vi, file);
                                e.target.value = "";
                              }}
                            />
                            {uploadingImage === `${gi}-${vi}` ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ImagePlus className="size-4" />
                            )}
                          </label>
                        )}
                      </div>
                      {/* Value input */}
                      <Input
                        value={val.value}
                        onChange={(e) => updateOptionValue(gi, vi, e.target.value)}
                        placeholder="ค่า"
                        className="h-7 flex-1 text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-slate-400 hover:text-red-500"
                        onClick={() => removeOptionValue(gi, vi)}
                        aria-label="ลบค่า"
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-[#10B981]"
                    onClick={() => addOptionValue(gi)}
                  >
                    <Plus className="size-3" />
                    เพิ่มค่า
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5 border-dashed border-slate-300 text-sm text-slate-600"
              onClick={addOptionGroup}
            >
              <Plus className="size-4" />
              เพิ่มกลุ่มตัวเลือก
            </Button>
          </div>

          {/* Generate + Manage Variants (existing products only) */}
          {current && (
            <VariantManager productId={current.id} price={Number(form.price) || 0} />
          )}
        </div>

        {/* ═══ Product Attributes ═══════════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <Tag className="size-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900">ข้อมูลสินค้า (Attributes)</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            ข้อมูลเพิ่มเติม เช่น แบรนด์, วัสดุ, น้ำหนัก — ไม่ได้ใช้สำหรับเลือกซื้อ
          </p>

          <div className="mt-3 space-y-2">
            {attributes.map((attr, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <Input
                  value={attr.name}
                  onChange={(e) => updateAttribute(ai, "name", e.target.value)}
                  placeholder="ชื่อ เช่น แบรนด์"
                  className="h-8 flex-1 text-sm"
                />
                <Input
                  value={attr.value}
                  onChange={(e) => updateAttribute(ai, "value", e.target.value)}
                  placeholder="ค่า เช่น Nike"
                  className="h-8 flex-1 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-slate-400 hover:text-red-500"
                  onClick={() => removeAttribute(ai)}
                  aria-label="ลบ attribute"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5 border-dashed border-slate-300 text-sm text-slate-600"
              onClick={addAttribute}
            >
              <Plus className="size-4" />
              เพิ่มข้อมูลสินค้า
            </Button>
          </div>
        </div>

        {/* ═══ Submit for review ═══════════════════════════════════════ */}
        <div className="flex items-center gap-2 rounded-[10px] border border-slate-200 px-3 py-2.5">
          <Store className="size-4 shrink-0 text-[#10B981]" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">ส่งตรวจสอบเพื่อขายที่หน้าร้าน velshop</p>
            <p className="text-xs text-slate-400">
              ต้องตั้งราคาและสต็อกก่อน — หลังส่งแล้วทีมงานตรวจสอบก่อนประกาศขายจริง
            </p>
          </div>
          <Switch checked={form.published} onCheckedChange={(v) => set("published", v)} aria-label="ส่งตรวจสอบ" />
        </div>

        {current && (
          <div className="rounded-[10px] border border-slate-200 p-4">
            <ImageUploader
              product={current}
              onChange={(updated) => {
                setCurrent(updated);
                onSaved?.(updated);
              }}
            />
          </div>
        )}

        {hasOptions && (
          <p className="text-xs text-slate-500">
            ℹ️ ตัวเลือกสินค้าที่กรอกจะถูกบันทึกหลังกดบันทึกสินค้า — จากนั้นสามารถสร้าง Variant อัตโนมัติได้
          </p>
        )}

        <DialogFooter className="mt-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-slate-200 text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            {current && !isEdit ? "ปิด" : "ยกเลิก"}
          </Button>
          {(isEdit || !current) && (
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function ProductFormDialog({ open, onOpenChange, shop, product, onSaved }: ProductFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ProductFormInner
          key={product?.id ?? "new"}
          shop={shop}
          product={product ?? null}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}
