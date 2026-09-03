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
import { Checkbox } from "@velnox/shared/components/ui/checkbox";
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
  RefreshCw,
  CalendarClock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────
interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shop: StoreShop;
  product?: StoreProduct | null;
  onSaved?: (product: StoreProduct) => void;
}

interface InnerProps {
  shop: StoreShop;
  product: StoreProduct | null;
  onClose: () => void;
  onSaved?: (product: StoreProduct) => void;
}

interface OptionValueForm {
  id?: string;
  value: string;
  label: string;
  imageUrl?: string | null;
  isEnabled?: boolean;
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

interface DraftImage {
  url: string;
  objectKey?: string;
  alt?: string;
}

interface DraftVariant {
  key: string; // e.g. "0-1" for group0/value1, or "0-1:2-0" for group0/value1+group2/value0
  name: string;
  optionValueIndices: number[]; // indices into flat option values
  sku: string;
  price: string;
  compareAtPrice: string;
  discountPercent: string;
  stock: string;
  images: DraftImage[];
}

interface VelRepeatForm {
  enabled: boolean;
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  weeklyPrice: string;
  monthlyPrice: string;
  weeklyQty: string;
  monthlyQty: string;
}

// ─── Variant row for existing products (edit mode) ───────────────────
interface VariantRow {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  compareAtPrice?: number | null;
  discountPercent?: number | null;
  stock: number;
  status: string;
  optionLabels: string;
  imageUrl?: string | null;
  images?: Array<{ id: string; url: string; alt?: string }>;
}

// ─── Helper: get R2 base URL ─────────────────────────────────────────
const API_BASE = () => import.meta.env.VITE_API_URL || "";

// ─── Helper: draft upload ─────────────────────────────────────────────
async function draftUpload(
  draftId: string,
  file: File,
  subfolder: string,
): Promise<DraftImage> {
  const baseUrl = API_BASE();
  const intentRes = await fetch(`${baseUrl}/api/seller/products/draft-upload-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ draftId, filename: file.name, mimeType: file.type, subfolder }),
  });
  const intentData = await intentRes.json();
  if (!intentData.success) throw new Error(intentData.error?.message || "Failed to get upload URL");

  const uploadRes = await fetch(intentData.data.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);

  return { url: intentData.data.cdnUrl, objectKey: intentData.data.objectKey, alt: file.name };
}

// ─── Variant Manager for existing products (edit mode) ────────────────
function VariantManager({ productId, price }: { productId: string; price: number }) {
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<{ price: string; compareAtPrice: string; discountPercent: string; stock: string; sku: string; status: string }>({ price: "", compareAtPrice: "", discountPercent: "", stock: "", sku: "", status: "active" });
  const [loaded, setLoaded] = useState(false);
  const [featuredVariantId, setFeaturedVariantId] = useState<string | null>(null);
  const baseUrl = API_BASE();

  const fetchVariants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants`, { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        const variantList = data.data ?? [];
        const withImages = await Promise.all(variantList.map(async (v: VariantRow) => {
          try {
            const imgRes = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${v.id}/images`, { credentials: "include" });
            const imgData = await imgRes.json();
            const imgs = imgData.data ?? [];
            return { ...v, imageUrl: imgs[0]?.url ?? null, images: imgs.map((img: any) => ({ id: img.id, url: img.url, alt: img.alt || '' })) };
          } catch { return v; }
        }));
        setVariants(withImages);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [productId, baseUrl]);

  // Load featured variant from product data
  useEffect(() => {
    const fvId = (window as any).__productFeaturedVariantId;
    if (fvId) setFeaturedVariantId(fvId);
  }, []);

  useEffect(() => { if (!loaded) { fetchVariants(); setLoaded(true); } }, [loaded, fetchVariants]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) { toast.success(`สร้าง ${data.data?.variants?.length ?? 0} variants สำเร็จ`); await fetchVariants(); }
      else toast.error(data.error?.message || "สร้าง variant ไม่สำเร็จ");
    } catch { toast.error("สร้าง variant ไม่สำเร็จ"); }
    setGenerating(false);
  };

  const startEdit = (v: VariantRow) => {
    setEditingId(v.id);
    setEditFields({ price: String(v.price), compareAtPrice: v.compareAtPrice != null ? String(v.compareAtPrice) : "", discountPercent: v.discountPercent != null ? String(v.discountPercent) : "", stock: String(v.stock), sku: v.sku ?? "", status: v.status });
  };

  const saveEdit = async (variantId: string) => {
    try {
      const fullPrice = Number(editFields.compareAtPrice) || 0;
      const discPct = Number(editFields.discountPercent) || 0;
      const finalPrice = Math.max(0, Math.round(fullPrice * (1 - discPct / 100) * 100) / 100);
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${variantId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ price: finalPrice, compareAtPrice: fullPrice || null, discountPercent: discPct || null, stock: Number(editFields.stock), sku: editFields.sku || null, status: editFields.status }),
      });
      const data = await res.json();
      if (data.success) { setEditingId(null); await fetchVariants(); toast.success("บันทึก variant แล้ว"); }
      else toast.error(data.error?.message || "บันทึกไม่สำเร็จ");
    } catch { toast.error("บันทึกไม่สำเร็จ"); }
  };

  const handleSetFeatured = async (variantId: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/featured-variant`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ variantId }),
      });
      const data = await res.json();
      if (data.success) { setFeaturedVariantId(variantId); toast.success("ตั้งเป็นราคาหลักแล้ว"); }
      else toast.error(data.error?.message || "ไม่สำเร็จ");
    } catch { toast.error("ไม่สำเร็จ"); }
  };

  const handleVariantImageDelete = async (variantId: string, imageId: string) => {
    try {
      await fetch(`${baseUrl}/api/seller/products/${productId}/images/${imageId}`, { method: "DELETE", credentials: "include" });
      await fetchVariants();
    } catch { /* best effort */ }
  };

  const handleDelete = async (variantId: string) => {
    try {
      await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${variantId}`, { method: "DELETE", credentials: "include" });
      await fetchVariants();
    } catch { /* best effort */ }
  };

  const [uploadingVariantImage, setUploadingVariantImage] = useState<string | null>(null);

  const handleVariantImageUpload = async (variantId: string, file: File) => {
    const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!ACCEPT.includes(file.type)) { toast.error("ไฟล์ไม่ใช่รูปภาพที่รองรับ"); return; }
    setUploadingVariantImage(variantId);
    try {
      const intentRes = await fetch(`${baseUrl}/api/seller/products/image-upload-intent`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ productId, filename: file.name, mimeType: file.type }),
      });
      const intentData = await intentRes.json();
      if (!intentData.success) throw new Error(intentData.error?.message || "Failed to get upload URL");
      const uploadRes = await fetch(intentData.data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);
      const saveRes = await fetch(`${baseUrl}/api/seller/products/${productId}/variants/${variantId}/images`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ url: intentData.data.cdnUrl, alt: file.name, storageKey: intentData.data.objectKey }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) throw new Error(saveData.error?.message || "Failed to save variant image");
      await fetchVariants();
      toast.success("อัปโหลดรูป variant สำเร็จ");
    } catch (err) {
      console.error("Variant image upload error:", err);
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally { setUploadingVariantImage(null); }
  };

  if (variants.length === 0 && !loading) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3">
        <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed border-[#10B981] text-sm text-[#10B981] hover:bg-[#ECFDF5]" onClick={handleGenerate} disabled={generating}>
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
                <Input value={editFields.compareAtPrice} onChange={(e) => setEditFields((f) => ({ ...f, compareAtPrice: e.target.value }))} type="number" className="h-7 w-16 text-xs" placeholder="ราคาเต็ม" />
                <Input value={editFields.discountPercent} onChange={(e) => setEditFields((f) => ({ ...f, discountPercent: e.target.value }))} type="number" min="0" className="h-7 w-12 text-xs" placeholder="ส่วนลด" />
                <Input value={editFields.stock} onChange={(e) => setEditFields((f) => ({ ...f, stock: e.target.value }))} type="number" className="h-7 w-14 text-xs" placeholder="stock" />
                <Input value={editFields.sku} onChange={(e) => setEditFields((f) => ({ ...f, sku: e.target.value }))} className="h-7 w-20 text-xs" placeholder="SKU" />
                <Button type="button" size="sm" className="h-7 text-xs" onClick={() => saveEdit(v.id)}>บันทึก</Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>ยกเลิก</Button>
              </>
            ) : (
              <>
                <div className="relative shrink-0">
                  <label className="flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                    {v.imageUrl ? (
                      <img src={v.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center">
                        {uploadingVariantImage === v.id ? <Loader2 className="size-3 animate-spin text-slate-300" /> : <ImagePlus className="size-3 text-slate-300" />}
                      </span>
                    )}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVariantImageUpload(v.id, f); e.target.value = ""; }} />
                  </label>
                  {v.images && v.images.length > 0 && (
                    <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-slate-700 text-[8px] font-semibold text-white">{v.images.length}</span>
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{v.name}</span>
                <span className="shrink-0 tabular-nums font-semibold text-slate-900">฿{(() => { const full = v.compareAtPrice || v.price || 0; const disc = v.discountPercent || 0; return Math.max(0, Math.round(full * (1 - disc / 100) * 100) / 100).toLocaleString(); })()}</span>
                {v.compareAtPrice && v.compareAtPrice > v.price && <span className="shrink-0 text-[10px] text-slate-400 line-through">฿{v.compareAtPrice}</span>}
                {v.discountPercent != null && v.discountPercent > 0 && <span className="shrink-0 rounded bg-red-50 px-1 py-0.5 text-[10px] font-semibold text-red-600">-{Math.round(v.discountPercent)}%</span>}
                <span className={`shrink-0 tabular-nums ${v.stock <= 0 ? "text-red-500" : v.stock <= 5 ? "text-amber-600" : "text-slate-600"}`}>{v.stock} ชิ้น</span>
                {v.sku && <span className="shrink-0 font-mono text-[10px] text-slate-400">{v.sku}</span>}
                <Badge className={`shrink-0 text-[10px] ${v.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{v.status}</Badge>
                <button type="button" className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${featuredVariantId === v.id ? "bg-amber-100 text-amber-700 font-semibold" : "text-slate-400 hover:text-amber-600"}`} onClick={() => handleSetFeatured(v.id)} title="ใช้เป็นราคาหลัก">
                  {featuredVariantId === v.id ? "★" : "☆"}
                </button>
                <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-slate-700" onClick={() => startEdit(v)} aria-label="แก้ไข"><Pencil className="size-3" /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-red-500" onClick={() => handleDelete(v.id)} aria-label="ลบ"><Trash2 className="size-3" /></Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Default form state ──────────────────────────────────────────────
const defaultForm = {
  name: "",
  category: "general" as StoreProductCategory,
  unit: "ชิ้น",
  description: "",
  supplier: "",
  published: false,
};

const defaultVelRepeat: VelRepeatForm = {
  enabled: false, weeklyEnabled: false, monthlyEnabled: false,
  weeklyPrice: "", monthlyPrice: "", weeklyQty: "", monthlyQty: "",
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

function ProductFormInner({ shop, product, onClose, onSaved }: InnerProps) {
  const navigate = useNavigate();
  const createProduct = useAction(api.commerce.createProductAction);
  const createFullProduct = useAction(api.commerce.createFullProductAction);
  const updateProduct = useAction(api.commerce.updateProductAction);
  // Product-level stock management removed — variant stock is source of truth

  const [form, setForm] = useState<typeof defaultForm>(() =>
    product
      ? {
          name: product.name,
          category: product.category,
          unit: product.unit,
          description: product.description ?? "",
          supplier: product.supplier ?? "",
          published: product.status === "published",
        }
      : defaultForm,
  );
  const [current, setCurrent] = useState<StoreProduct | null>(product ?? null);
  const [saving, setSaving] = useState(false);
  const isEdit = product !== null;

  // ─── Draft state (for new products) ──────────────────────────────────
  const [draftId] = useState(() => crypto.randomUUID());
  const [galleryImages, setGalleryImages] = useState<DraftImage[]>([]);
  const [detailImages, setDetailImages] = useState<DraftImage[]>([]);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [uploadingDetail, setUploadingDetail] = useState(false);

  // ─── Option groups state ──────────────────────────────────────────────
  const [optionGroups, setOptionGroups] = useState<OptionGroupForm[]>([]);
  const [attributes, setAttributes] = useState<AttributeForm[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // ─── Variant state (auto-generated from options) ──────────────────────
  const [draftVariants, setDraftVariants] = useState<DraftVariant[]>([]);

  // ─── VelRepeat state ──────────────────────────────────────────────────
  const [velRepeat, setVelRepeat] = useState<VelRepeatForm>(() =>
    product ? {
      enabled: product.vrepeatEnabled ?? false,
      weeklyEnabled: product.vrepeatWeeklyEnabled ?? false,
      monthlyEnabled: product.vrepeatMonthlyEnabled ?? false,
      weeklyPrice: product.vrepeatWeeklyPrice != null ? String(product.vrepeatWeeklyPrice) : "",
      monthlyPrice: product.vrepeatMonthlyPrice != null ? String(product.vrepeatMonthlyPrice) : "",
      weeklyQty: product.vrepeatWeeklyQty != null ? String(product.vrepeatWeeklyQty) : "",
      monthlyQty: product.vrepeatMonthlyQty != null ? String(product.vrepeatMonthlyQty) : "",
    } : defaultVelRepeat,
  );
  const [velRepeatExpanded, setVelRepeatExpanded] = useState(false);

  // ─── Featured variant (for create mode, track by draftVariant key) ────
  const [featuredVariantKey, setFeaturedVariantKey] = useState<string | null>(null);

  // ─── Validation errors ────────────────────────────────────────────────
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Load existing options when editing
  useEffect(() => {
    if (!current?.id || optionsLoaded) return;
    const loadOptions = async () => {
      try {
        const baseUrl = API_BASE();
        const res = await fetch(`${baseUrl}/api/seller/products/${current.id}/options`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data) {
          const groups = (data.data.optionGroups ?? []).map((g: any) => ({
            id: g.id, name: g.name, displayType: g.displayType ?? "text",
            values: (g.values ?? []).map((v: any) => ({ id: v.id, value: v.value, label: v.label ?? v.value, imageUrl: v.imageUrl ?? null, isEnabled: v.is_enabled !== false })),
          }));
          setOptionGroups(groups);
          setAttributes((data.data.attributes ?? []).map((a: any) => ({ id: a.id, name: a.name, value: a.value })));
        }
      } catch { /* ignore */ }
      setOptionsLoaded(true);
    };
    void loadOptions();
  }, [current?.id, optionsLoaded]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ─── Option group helpers ─────────────────────────────────────────────
  const addOptionGroup = () => setOptionGroups((prev) => [...prev, { name: "", displayType: "text", values: [{ value: "", label: "" }] }]);
  const removeOptionGroup = (index: number) => setOptionGroups((prev) => prev.filter((_, i) => i !== index));
  const updateGroupName = (index: number, name: string) => setOptionGroups((prev) => prev.map((g, i) => i === index ? { ...g, name } : g));
  const updateGroupDisplayType = (index: number, displayType: string) => setOptionGroups((prev) => prev.map((g, i) => i === index ? { ...g, displayType } : g));
  const addOptionValue = (groupIndex: number) => setOptionGroups((prev) => prev.map((g, i) => i === groupIndex ? { ...g, values: [...g.values, { value: "", label: "", isEnabled: true }] } : g));
  const removeOptionValue = (groupIndex: number, valueIndex: number) => setOptionGroups((prev) => prev.map((g, i) => i === groupIndex ? { ...g, values: g.values.filter((_, vi) => vi !== valueIndex) } : g));
  const updateOptionValue = (groupIndex: number, valueIndex: number, value: string) =>
    setOptionGroups((prev) => prev.map((g, i) => i === groupIndex ? { ...g, values: g.values.map((v, vi) => vi === valueIndex ? { ...v, value, label: value } : v) } : g));
  const updateOptionValueEnabled = (groupIndex: number, valueIndex: number, isEnabled: boolean) =>
    setOptionGroups((prev) => prev.map((g, i) => i === groupIndex ? { ...g, values: g.values.map((v, vi) => vi === valueIndex ? { ...v, isEnabled } : v) } : g));

  const updateOptionValueImage = (groupIndex: number, valueIndex: number, imageUrl: string | null) =>
    setOptionGroups((prev) => prev.map((g, i) => i === groupIndex ? { ...g, values: g.values.map((v, vi) => vi === valueIndex ? { ...v, imageUrl } : v) } : g));

  // ─── Auto-generate variants from option groups ────────────────────────
  const generateVariants = useCallback(() => {
    const validGroups = optionGroups.filter((g) => g.name.trim() && g.values.some((v) => v.value.trim() && (v.isEnabled !== false)));
    if (validGroups.length === 0) {
      // No options → auto-create single variant for the product
      setDraftVariants((prev) => {
        const existing = prev.find((p) => p.key === "default");
        return [{
          key: "default",
          name: form.name.trim() || "Default",
          optionValueIndices: [],
          sku: existing?.sku ?? "",
          price: existing?.price ?? "",
          compareAtPrice: existing?.compareAtPrice ?? "",
          discountPercent: existing?.discountPercent ?? "",
          stock: existing?.stock ?? "0",
          images: existing?.images ?? [],
        }];
      });
      return;
    }

    // Build cartesian product of option values
    const valueArrays: { groupIdx: number; valueIdx: number; value: string; groupName: string; imageUrl?: string | null }[][] =
      validGroups.map((g, gi) =>
        g.values.filter((v) => v.value.trim() && (v.isEnabled !== false)).map((v, vi) => ({
          groupIdx: optionGroups.indexOf(g), valueIdx: vi, value: v.value, groupName: g.name, imageUrl: v.imageUrl,
        }))
      );

    const cartesian = valueArrays.reduce<{ groupIdx: number; valueIdx: number; value: string; groupName: string; imageUrl?: string | null }[][]>(
      (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
      [[]],
    );

    const newVariants: DraftVariant[] = cartesian.map((combo, i) => ({
      key: combo.map((c) => `${c.groupIdx}-${c.valueIdx}`).join(":"),
      name: combo.map((c) => c.value).join(" / "),
      optionValueIndices: combo.map((c) => c.valueIdx),
      sku: "",
      price: "",
      compareAtPrice: "",
      discountPercent: "",
      stock: "0",
      images: [],
    }));

    // Preserve existing data (images, prices, stock) for matching variants
    setDraftVariants((prev) =>
      newVariants.map((nv) => {
        const existing = prev.find((p) => p.key === nv.key);
        return existing ? { ...nv, images: existing.images, compareAtPrice: existing.compareAtPrice, discountPercent: existing.discountPercent, stock: existing.stock, sku: existing.sku } : nv;
      })
    );
  }, [optionGroups]);

  // Auto-regenerate variants when option groups change (for new products only)
  useEffect(() => {
    if (!isEdit) generateVariants();
  }, [optionGroups, isEdit, generateVariants]);

  // ─── Gallery image upload (draft) ─────────────────────────────────────
  const handleGalleryUpload = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 10 - galleryImages.length);
    if (list.length === 0) return;
    setUploadingGallery(true);
    try {
      const results = await Promise.all(list.map((f) => draftUpload(draftId, f, "preview")));
      setGalleryImages((prev) => [...prev, ...results]);
      toast.success(`อัปโหลด ${results.length} รูปสำเร็จ`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally { setUploadingGallery(false); }
  };

  const removeGalleryImage = (index: number) => setGalleryImages((prev) => prev.filter((_, i) => i !== index));

  // ─── Detail image upload (draft) ──────────────────────────────────────
  const handleDetailUpload = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 10 - detailImages.length);
    if (list.length === 0) return;
    setUploadingDetail(true);
    try {
      const results = await Promise.all(list.map((f) => draftUpload(draftId, f, "details")));
      setDetailImages((prev) => [...prev, ...results]);
      toast.success(`อัปโหลด ${results.length} รูปสำเร็จ`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally { setUploadingDetail(false); }
  };

  const removeDetailImage = (index: number) => setDetailImages((prev) => prev.filter((_, i) => i !== index));

  // ─── Option value image upload (draft) ──────────────────────────────
  const handleOptionImageUpload = async (groupIndex: number, valueIndex: number, file: File) => {
    const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!ACCEPT.includes(file.type)) { toast.error("ไฟล์ไม่ใช่รูปภาพที่รองรับ"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("ไฟล์ใหญ่เกิน 5 MB"); return; }
    try {
      const img = await draftUpload(draftId, file, `options/${groupIndex}/${valueIndex}`);
      updateOptionValueImage(groupIndex, valueIndex, img.url);
      toast.success("อัปโหลดรูปตัวเลือกสำเร็จ");
    } catch (err) {
      console.error("Option image upload error:", err);
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    }
  };

  // ─── Attribute helpers ────────────────────────────────────────────────
  const addAttribute = () => setAttributes((prev) => [...prev, { name: "", value: "" }]);
  const removeAttribute = (index: number) => setAttributes((prev) => prev.filter((_, i) => i !== index));
  const updateAttribute = (index: number, field: "name" | "value", val: string) =>
    setAttributes((prev) => prev.map((a, i) => i === index ? { ...a, [field]: val } : a));

  // ─── Save options to server (edit mode) ───────────────────────────────
  const saveOptions = useCallback(async (productId: string) => {
    const baseUrl = API_BASE();
    for (const group of optionGroups) {
      if (!group.name.trim()) continue;
      let groupId = group.id;
      if (groupId) {
        // Update existing group (name + displayType)
        try { await fetch(`${baseUrl}/api/seller/products/${productId}/option-groups/${groupId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: group.name.trim(), displayType: group.displayType }) }); } catch { /* best effort */ }
      } else {
        try {
          const res = await fetch(`${baseUrl}/api/seller/products/${productId}/option-groups`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: group.name.trim(), displayType: group.displayType }) });
          const data = await res.json();
          if (data.success && data.data?.id) groupId = data.data.id;
        } catch { continue; }
      }
      if (!groupId) continue;
      for (const val of group.values) {
        if (!val.value.trim()) continue;
        if (val.id) {
          // Update existing value (isEnabled, imageUrl)
          try { await fetch(`${baseUrl}/api/seller/products/${productId}/option-values/${val.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ value: val.value.trim(), label: val.label || val.value.trim(), imageUrl: val.imageUrl || null, isEnabled: val.isEnabled !== false }) }); } catch { /* best effort */ }
        } else {
          // Create new value
          try { await fetch(`${baseUrl}/api/seller/products/${productId}/option-groups/${groupId}/values`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ value: val.value.trim(), label: val.label || val.value.trim(), imageUrl: val.imageUrl || null, isEnabled: val.isEnabled !== false }) }); } catch { /* best effort */ }
        }
      }
    }
    for (const attr of attributes) {
      if (!attr.name.trim() || !attr.value.trim() || attr.id) continue;
      try { await fetch(`${baseUrl}/api/seller/products/${productId}/attributes`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: attr.name.trim(), value: attr.value.trim() }) }); } catch { /* best effort */ }
    }
  }, [optionGroups, attributes]);

  // ─── Validation ───────────────────────────────────────────────────────
  const validate = useCallback((): string[] => {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push("กรุณากรอกชื่อสินค้า");
    if (variantCount > 100) errors.push("จำนวน Variant เกินขีดจำกัด 100 — กรุณาลดจำนวนตัวเลือก");
    if (galleryImages.length === 0 && (!current?.images || current.images.length === 0)) errors.push("ต้องมีรูปตัวอย่างสินค้าอย่างน้อย 1 รูป");
    // Validate option values
    for (const group of optionGroups) {
      if (group.name.trim() && group.values.filter((v) => v.value.trim()).length < 2) {
        errors.push(`กลุ่มตัวเลือก "${group.name}" ต้องมีอย่างน้อย 2 ค่า`);
      }
    }
    // Validate variants: each must have fullPrice > 0
    if (!isEdit && draftVariants.length > 0) {
      for (const v of draftVariants) {
        const fullPrice = Number(v.compareAtPrice);
        if (!v.compareAtPrice || !Number.isFinite(fullPrice) || fullPrice < 0) {
          errors.push(`Variant "${v.name}" ต้องกรอกราคาเต็มที่ถูกต้อง`);
        }
        const disc = Number(v.discountPercent);
        if (v.discountPercent && (!Number.isFinite(disc) || disc < 0 || disc > 100)) {
          errors.push(`Variant "${v.name}" ส่วนลดต้องอยู่ระหว่าง 0-100%`);
        }
      }
      const hasStock = draftVariants.some((v) => Number(v.stock) > 0);
      if (!hasStock) errors.push("ต้องมี variant อย่างน้อย 1 ตัวที่มี stock > 0");
    }
    return errors;
  }, [form, galleryImages, current, optionGroups, draftVariants, isEdit]);

  // ─── Submit handler ───────────────────────────────────────────────────
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validate();
    if (errors.length > 0) {
      setValidationErrors(errors);
      toast.error(errors[0]);
      return;
    }
    setValidationErrors([]);

    setSaving(true);
    try {
      if (isEdit && current) {
        // Edit mode: update product then save options separately
        // Price comes from variants — use 0 for product-level price (variant pricing is source of truth)
        const updated = await updateProduct({
          productId: current.id,
          name: form.name,
          category: form.category,
          unit: form.unit.trim() || "ชิ้น",
          price: 0,
          description: form.description || undefined,
          supplier: form.supplier || undefined,
          status: form.published ? "published" : "draft",
        });
        if (updated) {
          // Product-level stock removed — variant stock is source of truth
          await saveOptions(current.id);
          // Upload detail images (edit mode)
          if (detailImages.length > 0) {
            const baseUrl = API_BASE();
            for (let i = 0; i < detailImages.length; i++) {
              const img = detailImages[i];
              if (img.url) {
                await fetch(`${baseUrl}/api/seller/products/save-image`, {
                  method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                  body: JSON.stringify({ productId: current.id, objectKey: img.objectKey || img.url, cdnUrl: img.url, alt: img.alt || "", imageType: "detail" }),
                }).catch(() => {});
              }
            }
          }
          toast.success("บันทึกสินค้าแล้ว");
          setCurrent(updated);
          onSaved?.(updated);
        }
      } else {
        // NEW product: use create-full for atomic creation
        // Price is at variant level — use first variant's fullPrice for product.price (DB required)
        const firstFullPrice = draftVariants.length > 0 ? (Number(draftVariants[0].compareAtPrice) || 0) : 0;
        const payload: Record<string, any> = {
          product: {
            name: form.name.trim(),
            category: form.category,
            unit: form.unit.trim() || "ชิ้น",
            price: firstFullPrice,
            description: form.description || "",
            supplier: form.supplier || null,
            status: "pending_review",
          },
          previewImages: galleryImages.map((img, i) => ({ url: img.url, alt: img.alt || "" })),
          detailImages: detailImages.map((img, i) => ({ url: img.url, alt: img.alt || "" })),
          optionGroups: optionGroups.filter((g) => g.name.trim()).map((g) => ({
            name: g.name.trim(),
            displayType: g.displayType,
            required: true,
            values: g.values.filter((v) => v.value.trim()).map((v) => ({
              value: v.value.trim(),
              label: v.label || v.value.trim(),
              imageUrl: v.imageUrl || null,
              isEnabled: v.isEnabled !== false,
            })),
          })),
          variants: draftVariants.map((v) => {
            const fullPrice = Number(v.compareAtPrice) || 0;
            const discPct = Number(v.discountPercent) || 0;
            const finalPrice = Math.max(0, Math.round(fullPrice * (1 - discPct / 100) * 100) / 100);
            // Map optionValueIndices to groupIdMap keys so backend can resolve server UUIDs
            const optionValueIds: string[] = [];
            const validGroups = optionGroups.filter((g) => g.name.trim() && g.values.some((val) => val.value.trim()));
            if (v.key !== "default" && validGroups.length > 0) {
              // Parse key like "0-1:1-0" → [{groupIdx:0, valueIdx:1}, {groupIdx:1, valueIdx:0}]
              const parts = v.key.split(":");
              for (const part of parts) {
                const [gIdx, vIdx] = part.split("-").map(Number);
                if (Number.isFinite(gIdx) && Number.isFinite(vIdx)) {
                  // Find the actual index in the full optionGroups array
                  const group = validGroups[gIdx];
                  if (group) {
                    const actualGroupIdx = optionGroups.indexOf(group);
                    optionValueIds.push(`value-${actualGroupIdx}-${vIdx}`);
                  }
                }
              }
            }
            return {
              name: v.name,
              sku: v.sku || null,
              price: finalPrice,
              compareAtPrice: fullPrice || null,
              discountPercent: discPct || null,
              stock: Math.max(0, Number(v.stock) || 0),
              status: "active",
              options: {},
              optionValueIds,
              images: v.images.map((img) => ({ url: img.url, alt: img.alt || v.name })),
            };
          }),
          attributes: attributes.filter((a) => a.name.trim() && a.value.trim()).map((a) => ({
            name: a.name.trim(),
            value: a.value.trim(),
          })),
        };

        // VelRepeat
        if (velRepeat.enabled) {
          payload.velRepeat = {
            enabled: true,
            weeklyEnabled: velRepeat.weeklyEnabled,
            monthlyEnabled: velRepeat.monthlyEnabled,
            weeklyPrice: velRepeat.weeklyPrice ? Number(velRepeat.weeklyPrice) : null,
            monthlyPrice: velRepeat.monthlyPrice ? Number(velRepeat.monthlyPrice) : null,
            weeklyQty: velRepeat.weeklyQty ? Number(velRepeat.weeklyQty) : null,
            monthlyQty: velRepeat.monthlyQty ? Number(velRepeat.monthlyQty) : null,
          };
        }

        // Featured variant: convert key to array index
        if (featuredVariantKey) {
          const fvIdx = draftVariants.findIndex((v) => v.key === featuredVariantKey);
          if (fvIdx >= 0) payload.product.featuredVariantIndex = fvIdx;
        }

        const created = await createFullProduct(payload);
        if (created) {
          toast.success("เพิ่มสินค้าสำเร็จ! สินค้าอยู่ในสถานะรอดำเนินการตรวจสอบ");
          onSaved?.(created);
          onClose();
        }
      }
    } catch (error) {
      console.error("Product save error:", error);
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally { setSaving(false); }
  };

  const hasOptions = optionGroups.some((g) => g.name.trim() && g.values.some((v) => v.value.trim()));

  // ─── Variant count for warning ──────────────────────────────────────
  const variantCount = useMemo(() => {
    const validGroups = optionGroups.filter((g) => g.name.trim() && g.values.filter((v) => v.value.trim() && (v.isEnabled !== false)).length >= 1);
    if (validGroups.length === 0) return 1;
    return validGroups.reduce((acc, g) => acc * g.values.filter((v) => v.value.trim() && (v.isEnabled !== false)).length, 1);
  }, [optionGroups]);

  // ─── Variant summary ──────────────────────────────────────────────────
  const variantSummary = useMemo(() => {
    if (!hasOptions) return null;
    const validGroups = optionGroups.filter((g) => g.name.trim() && g.values.some((v) => v.value.trim() && (v.isEnabled !== false)));
    if (validGroups.length === 0) return null;
    return validGroups.map((g) => `${g.name}: ${g.values.filter((v) => v.value.trim()).map((v) => v.value).join(", ")}`).join(" | ");
  }, [optionGroups, hasOptions]);

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{current ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</DialogTitle>
        <DialogDescription>
          {current ? `แก้ไขสินค้า ${current.name}` : `เพิ่มสินค้าใหม่ให้ร้าน ${shop.name} — กรอกข้อมูลทั้งหมดแล้วกด "เพิ่มสินค้า" เพียงครั้งเดียว`}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-5">
        {/* ═══ Validation Errors ═══════════════════════════════════════ */}
        {validationErrors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-700">กรุณาแก้ไขข้อผิดพลาด:</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-red-600">
              {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        )}

        {/* ═══ Section 1: Product Info ═══════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">ข้อมูลสินค้า</h3>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-name">ชื่อสินค้า *</Label>
              <Input id="p-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="เช่น แชมพูสมุนไพร ขนาด 300 มล." required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>หมวดหมู่</Label>
                <Select value={form.category} onValueChange={(v) => set("category", v as StoreProductCategory)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="เลือกหมวดหมู่" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRODUCT_CATEGORY_META).map(([key, meta]) => <SelectItem key={key} value={key}>{meta.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p-unit">หน่วย</Label>
                <Input id="p-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="ชิ้น, กล่อง, ถุง" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-desc">คำอธิบายสินค้า</Label>
              <Textarea id="p-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="เช่น สูตรคลาสสิก ปราศจากสารกันเสีย" rows={2} />
            </div>
          </div>
        </div>



        {/* ═══ Section 3: Option Groups ══════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <ListOrdered className="size-4 text-[#10B981]" />
            <h3 className="text-sm font-semibold text-slate-900">ตัวเลือกสินค้า (Option Groups)</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">สร้างตัวเลือกสินค้า เช่น สี, ขนาด — ระบบจะสร้าง Variant อัตโนมัติ</p>

          {variantCount > 100 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
              <p className="text-xs font-semibold text-red-700">⚠ ตัวเลือกที่เลือกจะสร้าง {variantCount.toLocaleString()} Variants — เกินขีดจำกัดสูงสุด 100</p>
              <p className="mt-1 text-[11px] text-red-500">กรุณาลดจำนวนตัวเลือกหรือยกเลิกบางค่าก่อนดำเนินการต่อ</p>
            </div>
          )}

          <div className="mt-3 space-y-3">
            {optionGroups.map((group, gi) => (
              <div key={gi} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <Input value={group.name} onChange={(e) => updateGroupName(gi, e.target.value)} placeholder="เช่น สี, ขนาด, รสชาติ" className="h-8 text-sm" />
                  <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <button type="button" className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${group.displayType === "text" ? "bg-[#10B981] text-white" : "text-slate-500 hover:text-slate-700"}`} onClick={() => updateGroupDisplayType(gi, "text")}>ข้อความ</button>
                    <button type="button" className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${group.displayType === "image" ? "bg-[#10B981] text-white" : "text-slate-500 hover:text-slate-700"}`} onClick={() => updateGroupDisplayType(gi, "image")}>รูปภาพ</button>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-red-400 hover:text-red-600" onClick={() => removeOptionGroup(gi)} aria-label="ลบกลุ่มตัวเลือก"><X className="size-4" /></Button>
                </div>
                <div className="mt-2 space-y-2">
                  {group.values.map((val, vi) => (
                    <div key={vi} className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${val.isEnabled !== false ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/60 opacity-55"}`}>
                      <Checkbox
                        checked={val.isEnabled !== false}
                        onCheckedChange={(checked) => updateOptionValueEnabled(gi, vi, checked === true)}
                        className="shrink-0"
                      />
                      <Input value={val.value} onChange={(e) => updateOptionValue(gi, vi, e.target.value)} placeholder="เช่น ดำ, ขาว, AI Version" className="h-7 flex-1 text-xs" />
                      {group.displayType === "image" && (
                        <div className="shrink-0">
                          <label className="flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-white text-slate-400 hover:border-[#10B981] hover:text-[#10B981]">
                            {val.imageUrl ? (
                              <img src={val.imageUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <ImagePlus className="size-3.5" />
                            )}
                            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOptionImageUpload(gi, vi, f); e.target.value = ""; }} />
                          </label>
                        </div>
                      )}
                      <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeOptionValue(gi, vi)} aria-label="ลบค่า"><X className="size-3" /></Button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-[10px] text-slate-500 hover:text-slate-700" onClick={() => {
                      setOptionGroups((prev) => prev.map((g, i) => i === gi ? { ...g, values: g.values.map((v) => ({ ...v, isEnabled: true })) } : g));
                    }}>เลือกทั้งหมด</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-[10px] text-slate-500 hover:text-slate-700" onClick={() => {
                      setOptionGroups((prev) => prev.map((g, i) => i === gi ? { ...g, values: g.values.map((v) => ({ ...v, isEnabled: false })) } : g));
                    }}>ยกเลิกทั้งหมด</Button>
                    <div className="flex-1" />
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-xs text-[#10B981]" onClick={() => addOptionValue(gi)}><Plus className="size-3" />เพิ่มค่า</Button>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed border-slate-300 text-sm text-slate-600" onClick={addOptionGroup}><Plus className="size-4" />เพิ่มกลุ่มตัวเลือก</Button>
          </div>

          {variantSummary && (
            <p className="mt-3 text-xs text-slate-500">Variant ที่จะสร้าง: {variantSummary} ({variantCount} รายการ)</p>
          )}
        </div>

        {/* ═══ Section 4: Variants (auto-generated) ══════════════════ */}
        {!isEdit && draftVariants.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="size-4 text-[#10B981]" />
              <h3 className="text-sm font-semibold text-slate-900">Variants ({draftVariants.length})</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">ราคาเต็ม + ส่วนลด % → ราคาหลังลด (ระบบคำนวณอัตโนมัติ) พร้อมสต็อก, SKU, และรูป</p>

            <div className="mt-3 space-y-3 max-h-96 overflow-y-auto">
              {draftVariants.map((v) => (
                <div key={v.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-slate-900">{v.name}</p>
                    {Number(v.stock) <= 0 && <Badge className="text-[10px] bg-red-50 text-red-600">หมด</Badge>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-[10px]">ราคาเต็ม</Label>
                      <Input type="number" min="0" step="0.5" value={v.compareAtPrice || v.price} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, compareAtPrice: e.target.value } : pv))} className="h-7 text-xs" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px]">ส่วนลด %</Label>
                      <Input type="number" min="0" max="100" value={v.discountPercent} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, discountPercent: e.target.value } : pv))} className="h-7 text-xs" placeholder="0" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-[10px]">สต็อก</Label>
                      <Input type="number" min="0" value={v.stock} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, stock: e.target.value } : pv))} className="h-7 text-xs" />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">ราคาหลังลด:</span>
                    <span className="text-xs font-bold text-[#10B981]">฿{(() => { const full = Number(v.compareAtPrice) || 0; const disc = Number(v.discountPercent) || 0; return Math.max(0, Math.round(full * (1 - disc / 100) * 100) / 100).toLocaleString(); })()}</span>
                    {Number(v.discountPercent) > 0 && <span className="rounded bg-red-50 px-1 py-0.5 text-[10px] font-semibold text-red-600">-{Math.round(Number(v.discountPercent))}%</span>}
                  </div>
                  {draftVariants.length > 1 && (
                    <button type="button" className="mt-1.5 text-[10px] text-blue-500 hover:text-blue-700" onClick={() => {
                      const first = draftVariants[0];
                      if (first) setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? pv : { ...pv, compareAtPrice: first.compareAtPrice, discountPercent: first.discountPercent }));
                    }}>คัดลอกราคาจาก Variant แรก</button>
                  )}
                  <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="featuredVariant"
                      className="accent-[#10B981] size-3.5"
                      checked={featuredVariantKey === v.key}
                      onChange={() => setFeaturedVariantKey(v.key)}
                    />
                    <span className="text-[10px] text-slate-600">★ ใช้เป็นราคาหลัก</span>
                  </label>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-[10px]">SKU</Label>
                      <Input value={v.sku} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, sku: e.target.value } : pv))} className="h-7 text-xs" placeholder="ไม่บังคับ" />
                    </div>
                    <div className="col-span-3 grid gap-1">
                      <Label className="text-[10px]">รูป (Option Value)</Label>
                      <p className="text-[10px] text-slate-400">รูปมาจากตัวเลือกสินค้า เช่น สีดำ → รูปดำ</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Section 5: Gallery Images ═════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">รูปตัวอย่างสินค้า *</h3>
              <p className="text-xs text-slate-500">รูปหลักแสดงที่หน้าร้าน</p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              {isEdit ? (current?.images?.filter((i) => i.imageType === "gallery" || !i.imageType).length ?? 0) : galleryImages.length} / 10
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(isEdit && current?.images ? current.images.filter((i) => i.imageType === "gallery" || !i.imageType) : galleryImages).map((img, i) => (
              <div key={i} className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-slate-200">
                <img src={"url" in img ? (img as any).url : ""} alt="" className="size-full object-cover" />
                {!isEdit && (
                  <button type="button" className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600" onClick={() => removeGalleryImage(i)}><X className="size-2.5" /></button>
                )}
              </div>
            ))}
            {(!isEdit ? galleryImages.length < 10 : (!current?.images || current.images.filter((i) => i.imageType === "gallery").length < 10)) && (
              <label className="flex size-20 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-[#10B981] hover:text-[#10B981]">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => { if (e.target.files) handleGalleryUpload(e.target.files); e.target.value = ""; }} />
                {uploadingGallery ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
              </label>
            )}
          </div>
        </div>

        {/* ═══ Section 6: Detail Images ══════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">รูปรายละเอียดสินค้า</h3>
              <p className="text-xs text-slate-500">แสดงในแท็บรายละเอียด (ไม่บังคับ)</p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              {isEdit ? ((current as any)?.detailImages?.length ?? 0) : detailImages.length} / 10
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(isEdit && (current as any)?.detailImages ? (current as any).detailImages : detailImages).map((img: any, i: number) => (
              <div key={i} className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-slate-200">
                <img src={img.url || ""} alt="" className="size-full object-cover" />
                {!isEdit && (
                  <button type="button" className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600" onClick={() => removeDetailImage(i)}><X className="size-2.5" /></button>
                )}
              </div>
            ))}
            {detailImages.length < 10 && (
              <label className="flex size-20 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-[#10B981] hover:text-[#10B981]">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => { if (e.target.files) handleDetailUpload(e.target.files); e.target.value = ""; }} />
                {uploadingDetail ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
              </label>
            )}
          </div>
        </div>

        {/* ═══ Section 7: Attributes ═════════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Tag className="size-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900">ข้อมูลสินค้า (Attributes)</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">ข้อมูลเพิ่มเติม เช่น แบรนด์, วัสดุ — ไม่ใช้สำหรับเลือกซื้อ</p>
          <div className="mt-3 space-y-2">
            {attributes.map((attr, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <Input value={attr.name} onChange={(e) => updateAttribute(ai, "name", e.target.value)} placeholder="ชื่อ เช่น แบรนด์" className="h-8 flex-1 text-sm" />
                <Input value={attr.value} onChange={(e) => updateAttribute(ai, "value", e.target.value)} placeholder="ค่า เช่น Nike" className="h-8 flex-1 text-sm" />
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeAttribute(ai)} aria-label="ลบ attribute"><X className="size-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed border-slate-300 text-sm text-slate-600" onClick={addAttribute}><Plus className="size-4" />เพิ่มข้อมูลสินค้า</Button>
          </div>
        </div>

        {/* ═══ Section 8: VelRepeat ══════════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <button type="button" onClick={() => setVelRepeatExpanded((v) => !v)} className="flex w-full items-center gap-2">
            <CalendarClock className="size-4 text-[#10B981]" />
            <h3 className="flex-1 text-left text-sm font-semibold text-slate-900">VelRepeat — ซื้อซ้ำอัตโนมัติ</h3>
            {velRepeatExpanded ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
          </button>
          {velRepeatExpanded && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={velRepeat.enabled} onCheckedChange={(v) => setVelRepeat((p) => ({ ...p, enabled: v }))} />
                <Label className="text-sm">เปิดใช้งาน VelRepeat</Label>
              </div>
              {velRepeat.enabled && (
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={velRepeat.weeklyEnabled} onCheckedChange={(v) => setVelRepeat((p) => ({ ...p, weeklyEnabled: v }))} />
                      <Label className="text-xs">Weekly</Label>
                    </div>
                    {velRepeat.weeklyEnabled && (
                      <>
                        <div className="grid gap-1"><Label className="text-[10px]">ราคา/สัปดาห์</Label><Input type="number" min="0" value={velRepeat.weeklyPrice} onChange={(e) => setVelRepeat((p) => ({ ...p, weeklyPrice: e.target.value }))} className="h-7 text-xs" /></div>
                        <div className="grid gap-1"><Label className="text-[10px]">จำนวน</Label><Input type="number" min="1" value={velRepeat.weeklyQty} onChange={(e) => setVelRepeat((p) => ({ ...p, weeklyQty: e.target.value }))} className="h-7 text-xs" /></div>
                      </>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={velRepeat.monthlyEnabled} onCheckedChange={(v) => setVelRepeat((p) => ({ ...p, monthlyEnabled: v }))} />
                      <Label className="text-xs">Monthly</Label>
                    </div>
                    {velRepeat.monthlyEnabled && (
                      <>
                        <div className="grid gap-1"><Label className="text-[10px]">ราคา/เดือน</Label><Input type="number" min="0" value={velRepeat.monthlyPrice} onChange={(e) => setVelRepeat((p) => ({ ...p, monthlyPrice: e.target.value }))} className="h-7 text-xs" /></div>
                        <div className="grid gap-1"><Label className="text-[10px]">จำนวน</Label><Input type="number" min="1" value={velRepeat.monthlyQty} onChange={(e) => setVelRepeat((p) => ({ ...p, monthlyQty: e.target.value }))} className="h-7 text-xs" /></div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ Section 9: Edit Mode — Variant Manager (existing products) ═══ */}
        {isEdit && current && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">จัดการ Variants</h3>
            <p className="mb-2 text-xs text-slate-500">แก้ไขราคา, สต็อก, รูปภาพ และ SKU ของแต่ละ Variant</p>
            <VariantManager productId={current.id} price={current.price} />
          </div>
        )}

        {/* ═══ Section 10: Submit ════════════════════════════════════ */}
        <div className="flex items-center gap-2 rounded-[10px] border border-slate-200 px-3 py-2.5">
          <Store className="size-4 shrink-0 text-[#10B981]" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">
              {isEdit ? "บันทึกการแก้ไข" : "เพิ่มสินค้า — สินค้าจะอยู่ในสถานะรอดำเนินการตรวจสอบ"}
            </p>
            <p className="text-xs text-slate-400">
              {isEdit ? "แก้ไขข้อมูลสินค้าที่มีอยู่" : "กรอกข้อมูลทั้งหมดแล้วกดเพิ่มเพียงครั้งเดียว"}
            </p>
          </div>
          {!isEdit && (
            <Switch checked={form.published} onCheckedChange={(v) => set("published", v)} aria-label="ส่งตรวจสอบ" />
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button type="button" variant="outline" className="border-slate-200 text-slate-700" onClick={onClose} disabled={saving}>
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
