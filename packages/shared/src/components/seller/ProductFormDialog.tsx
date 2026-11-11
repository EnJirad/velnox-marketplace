import { api } from "@velnox/shared/lib/api-routes";
import {
  type StoreProduct,
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
import { Switch } from "@velnox/shared/components/ui/switch";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { Checkbox } from "@velnox/shared/components/ui/checkbox";
import { ProductGallery } from "@velnox/shared/components/shop/ProductGallery";
import {
  ProductDescriptionEditor,
  type DescriptionBlock,
} from "@velnox/shared/components/shop/ProductDescriptionEditor";
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
  Star,
  Folder,
  ShoppingBag,
  Shirt,
  Book,
  Smartphone,
  Laptop,
  Home,
  Gift,
  Utensils,
} from "lucide-react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { CategoryPicker } from "@velnox/shared/components/seller/CategoryPicker";
import { pendingUploads, seedGalleries } from "@velnox/shared/lib/product-images";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useLanguage } from "@velnox/shared/lib/i18n";

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
  /** Set for images that already exist in the database (edit mode). */
  id?: string;
  url: string;
  objectKey?: string;
  alt?: string;
}

interface DraftVariant {
  key: string; // e.g. "0-1" for group0/value1, or "0-1:2-0" for group0/value1+group2/value0
  name: string;
  optionValueIndices: number[]; // indices into flat option values
  /** The exact option selection behind this variant (group name → chosen value).
   *  Sent to the backend so it can link the variant to real option_value rows. */
  selections: { groupName: string; valueText: string }[];
  sku: string;
  price: string;
  compareAtPrice: string;
  discountPercent: string;
  stock: string;
  images: DraftImage[];
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
  const { t } = useLanguage();
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
      if (data.success) { toast.success(t("productForm.variants.createdToast", { count: data.data?.variants?.length ?? 0 })); await fetchVariants(); }
      else toast.error(data.error?.message || t("productForm.variants.generateFailed"));
    } catch { toast.error(t("productForm.variants.generateFailed")); }
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
      if (data.success) { setEditingId(null); await fetchVariants(); toast.success(t("productForm.variants.savedToast")); }
      else toast.error(data.error?.message || t("productForm.variants.saveFailed"));
    } catch { toast.error(t("productForm.variants.saveFailed")); }
  };

  const handleSetFeatured = async (variantId: string) => {
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/featured-variant`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ variantId }),
      });
      const data = await res.json();
      if (data.success) { setFeaturedVariantId(variantId); toast.success(t("productForm.variants.featuredToast")); }
      else toast.error(data.error?.message || t("productForm.variants.actionFailed"));
    } catch { toast.error(t("productForm.variants.actionFailed")); }
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
    if (!ACCEPT.includes(file.type)) { toast.error(t("productForm.variants.unsupportedFile")); return; }
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
      toast.success(t("productForm.variants.imageUploaded"));
    } catch (err) {
      console.error("Variant image upload error:", err);
      toast.error(err instanceof Error ? err.message : t("productForm.variants.uploadFailed"));
    } finally { setUploadingVariantImage(null); }
  };

  if (variants.length === 0 && !loading) {
    return (
      <div className="mt-3 border-t border-slate-200 pt-3">
        <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed border-brand text-sm text-brand hover:bg-accent" onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : <ListOrdered className="size-4" />}
          {t("productForm.variants.generateCta")}
        </Button>
        <p className="mt-1 text-2xs text-slate-400">{t("productForm.variants.generateDesc")}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">{t("productForm.variants.countLabel", { count: variants.length })}</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs text-brand" onClick={handleGenerate} disabled={generating}>
          {generating ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          {t("productForm.variants.regenerate")}
        </Button>
      </div>
      <div className="mt-2 space-y-1.5">
        {variants.map((v) => (
          <div key={v.id} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
            {editingId === v.id ? (
              <div className="flex items-start gap-2">
                {/* Image column (left) — stays visible while editing */}
                <div className="relative shrink-0">
                  <label className="flex size-11 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {v.imageUrl ? (
                      <img src={v.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center">
                        {uploadingVariantImage === v.id ? <Loader2 className="size-4 animate-spin text-slate-300" /> : <ImagePlus className="size-4 text-slate-300" />}
                      </span>
                    )}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVariantImageUpload(v.id, f); e.target.value = ""; }} />
                  </label>
                  {v.images && v.images.length > 0 && (
                    <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-slate-700 text-[8px] font-semibold text-white">{v.images.length}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{v.name}</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <Input value={editFields.compareAtPrice} onChange={(e) => setEditFields((f) => ({ ...f, compareAtPrice: e.target.value }))} type="number" className="h-7 min-w-0 text-xs" placeholder={t("productForm.variants.fullPricePlaceholder")} />
                    <Input value={editFields.discountPercent} onChange={(e) => setEditFields((f) => ({ ...f, discountPercent: e.target.value }))} type="number" min="0" className="h-7 min-w-0 text-xs" placeholder={t("productForm.variants.discountPlaceholder")} />
                    <Input value={editFields.stock} onChange={(e) => setEditFields((f) => ({ ...f, stock: e.target.value }))} type="number" className="h-7 min-w-0 text-xs" placeholder={t("productForm.variants.stockPlaceholder")} />
                    <Input value={editFields.sku} onChange={(e) => setEditFields((f) => ({ ...f, sku: e.target.value }))} className="h-7 min-w-0 text-xs" placeholder="SKU" />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button type="button" size="sm" className="h-7 text-xs" onClick={() => saveEdit(v.id)}>{t("productForm.variants.save")}</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingId(null)}>{t("common.cancel")}</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Image column (left) */}
                <div className="relative shrink-0">
                  <label className="flex size-11 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {v.imageUrl ? (
                      <img src={v.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center">
                        {uploadingVariantImage === v.id ? <Loader2 className="size-4 animate-spin text-slate-300" /> : <ImagePlus className="size-4 text-slate-300" />}
                      </span>
                    )}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVariantImageUpload(v.id, f); e.target.value = ""; }} />
                  </label>
                  {v.images && v.images.length > 0 && (
                    <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-slate-700 text-[8px] font-semibold text-white">{v.images.length}</span>
                  )}
                </div>
                {/* Details column (right) */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{v.name}</span>
                    {v.discountPercent != null && v.discountPercent > 0 && <span className="shrink-0 rounded bg-red-50 px-1 py-0.5 text-2xs font-semibold text-red-600">-{Math.round(v.discountPercent)}%</span>}
                    <Badge className={`shrink-0 text-2xs ${v.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{v.status}</Badge>
                    <button type="button" className={`shrink-0 text-2xs px-1.5 py-0.5 rounded ${featuredVariantId === v.id ? "bg-amber-100 text-amber-700 font-semibold" : "text-slate-400 hover:text-amber-600"}`} onClick={() => handleSetFeatured(v.id)} title={t("productForm.variants.featuredTitle")}>
                      {featuredVariantId === v.id ? "★" : "☆"}
                    </button>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="tabular-nums font-semibold text-slate-900">฿{(() => { const full = v.compareAtPrice || v.price || 0; const disc = v.discountPercent || 0; return Math.max(0, Math.round(full * (1 - disc / 100) * 100) / 100).toLocaleString(); })()}</span>
                    {v.compareAtPrice && v.compareAtPrice > v.price && <span className="text-2xs text-slate-400 line-through">฿{v.compareAtPrice.toLocaleString()}</span>}
                    <span className={`tabular-nums ${v.stock <= 0 ? "text-red-500" : v.stock <= 5 ? "text-amber-600" : "text-slate-600"}`}>{t("productForm.variants.stockUnit", { count: v.stock })}</span>
                    {v.sku && <span className="font-mono text-2xs text-slate-400">{v.sku}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-2xs text-slate-500 hover:text-slate-700" onClick={() => startEdit(v)}><Pencil className="size-3" />{t("productForm.variants.edit")}</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-2xs text-slate-500 hover:text-red-600" onClick={() => handleDelete(v.id)}><Trash2 className="size-3" />{t("productForm.variants.delete")}</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Category options ────────────────────────────────────────────────
// Loaded from the Category API at runtime so the seller selector always
// matches the real `categories` table — no hard-coded slugs.
type CategoryOption = { id: string; slug: string; name: string; icon?: string; depth: number; parent_id?: string | null };
type CategoryTreeNode = { id: string; slug: string; name?: string; display_name?: string; icon?: string; parent_id?: string | null; sort_order?: number; is_active?: boolean; names?: Record<string, string>; children?: CategoryTreeNode[] };

/** Flatten a category tree into a flat list with depth for indentation. */
function flattenCategoryTree(nodes: any[], depth = 0): CategoryOption[] {
  const result: CategoryOption[] = [];
  for (const node of nodes) {
    result.push({
      id: String(node?.id ?? ""),
      slug: String(node?.slug ?? ""),
      name: String(node?.display_name ?? node?.name ?? node?.slug ?? ""),
      icon: node?.icon ?? undefined,
      depth,
      parent_id: node?.parent_id ?? null,
    });
    if (Array.isArray(node?.children) && node.children.length > 0) {
      result.push(...flattenCategoryTree(node.children, depth + 1));
    }
  }
  return result;
}

// ─── Default form state ──────────────────────────────────────────────
const defaultForm = {
  name: "",
  category: "",
  unit: "ชิ้น",
  description: "",
  supplier: "",
  published: false,
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

function ProductFormInner({ shop, product, onClose, onSaved }: InnerProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const createProduct = useAction(api.commerce.createProductAction);
  const createFullProduct = useAction(api.commerce.createFullProductAction);
  const updateProduct = useAction(api.commerce.updateProductAction);
  // Product-level stock management removed — variant stock is source of truth

  const [form, setForm] = useState<typeof defaultForm>(() =>
    product
      ? {
          name: product.name,
          // Prefer the canonical slug so the category select shows the current
          // value; legacy rows fall back to their stored category value.
          category: (product.categorySlug ?? product.category) as typeof defaultForm.category,
          unit: product.unit,
          description: product.description ?? "",
          supplier: product.supplier ?? "",
          published: product.status === "published",
        }
      : { ...defaultForm, unit: t("productForm.defaultUnit") },
  );
  const [current, setCurrent] = useState<StoreProduct | null>(product ?? null);
  /** Rich description blocks. Reopening a product shows the seller's own order. */
  const [blocks, setBlocks] = useState<DescriptionBlock[]>(
    () => (((product as any)?.descriptionBlocks ?? []) as DescriptionBlock[]),
  );
  useEffect(() => {
    setBlocks((((product as any)?.descriptionBlocks ?? []) as DescriptionBlock[]));
  }, [product]);
  const [saving, setSaving] = useState(false);

  // ─── Categories (DB-backed, localized) ────────────────────────────────
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryTreeNode[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError(false);
    try {
      // Try tree endpoint first for hierarchical display; fall back to flat list
      let list: CategoryOption[] = [];
      let tree: CategoryTreeNode[] = [];
      try {
        const treeData = await api.customer.categoryTreeAction();
        tree = Array.isArray(treeData) ? treeData : [];
        list = flattenCategoryTree(tree);
      } catch {
        // Fall back to flat categories if tree endpoint fails
        const rows = await api.customer.categoriesLocalized({ lang: "th" });
        list = (Array.isArray(rows) ? rows : [])
          .map((r: any) => ({
            id: String(r?.id ?? ""),
            slug: String(r?.slug ?? ""),
            name: String(r?.display_name ?? r?.name ?? r?.slug ?? ""),
            depth: 0,
          }))
          .filter((c: CategoryOption) => c.slug);
      }
      setCategories(list);
      setCategoryTree(tree);
      setForm((prev) => (prev.category ? prev : { ...prev, category: list[0]?.slug ?? "" }));
    } catch {
      setCategoriesError(true);
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => { void loadCategories(); }, [loadCategories]);

  // Get display name for the currently selected category
  const selectedCategoryName = useMemo(() => {
    if (!form.category) return null;
    const found = categories.find((c) => c.slug === form.category);
    return found?.name ?? null;
  }, [form.category, categories]);

  const selectedCategoryIconName = useMemo(() => {
    if (!form.category) return null;
    const found = categories.find((c) => c.slug === form.category);
    return found?.icon ?? null;
  }, [form.category, categories]);

  const CATEGORY_ICONS: Record<string, React.ElementType> = {
  folder: Folder,
  shopping: ShoppingBag,
  bag: ShoppingBag,
  shirt: Shirt,
  clothing: Shirt,
  fashion: Shirt,
  shoe: Book,
  footwear: Book,
  book: Book,
  phone: Smartphone,
  mobile: Smartphone,
  laptop: Laptop,
  computer: Laptop,
  home: Home,
  house: Home,
  gift: Gift,
  present: Gift,
  food: Utensils,
  restaurant: Utensils,
  dining: Utensils,
};

function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = name ? (CATEGORY_ICONS[name] ?? Tag) : Tag;
  return <Icon className={`size-4 shrink-0 text-slate-400 ${className ?? ""}`} />;
}
  const isEdit = product !== null;

  // ─── Draft state (for new products) ──────────────────────────────────
  const [draftId] = useState(() => crypto.randomUUID());
  // Existing product images are the editor's starting point: without this the
  // form opened empty for a product that already had images.
  const initialImages = seedGalleries(product?.images);
  const [galleryImages, setGalleryImages] = useState<DraftImage[]>(initialImages.gallery);
  const [detailImages, setDetailImages] = useState<DraftImage[]>(initialImages.detail);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  /**
   * Open the system file picker and resolve with the chosen image.
   *
   * A detached input is created per call so the rich-description blocks can add an
   * image without the dialog growing a second hidden input per block. Cancelling
   * resolves `null` — never a rejection — so the caller can simply do nothing.
   */
  const pickImageFile = (): Promise<File | null> =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp,image/avif";
      input.onchange = () => resolve(input.files?.[0] ?? null);
      // `cancel` is not universally supported; the change handler still fires with
      // no files on the platforms that lack it.
      input.oncancel = () => resolve(null);
      input.click();
    });

  /** Which thumbnail the preview is showing, and which tile is being dragged. */
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [uploadingDetail, setUploadingDetail] = useState(false);

  // ─── Option groups state ──────────────────────────────────────────────
  const [optionGroups, setOptionGroups] = useState<OptionGroupForm[]>([]);
  const [attributes, setAttributes] = useState<AttributeForm[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // ─── Variant state (auto-generated from options) ──────────────────────
  const [draftVariants, setDraftVariants] = useState<DraftVariant[]>([]);

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
          selections: [],
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

    const newVariants: DraftVariant[] = cartesian.map((combo, _i) => ({
      key: combo.map((c) => `${c.groupIdx}-${c.valueIdx}`).join(":"),
      name: combo.map((c) => c.value).join(" / "),
      optionValueIndices: combo.map((c) => c.valueIdx),
      selections: combo.map((c) => ({ groupName: c.groupName.trim(), valueText: c.value.trim() })),
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
      toast.success(t("productForm.uploadCountToast", { count: results.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("productForm.uploadFailed"));
    } finally { setUploadingGallery(false); }
  };

  // Existing images are deleted on the server immediately (ownership enforced
  // there); new drafts are just dropped from local state.
  /**
   * Reorder the gallery. The ARRAY ORDER is the product's gallery order (index 0
   * is the primary image, persisted as `sort_order` 0), so this is the whole
   * "change primary" operation — the shop then shows the same image first.
   */
  const moveGalleryImage = (from: number, to: number) => {
    setGalleryImages((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (!moved) return prev;
      next.splice(to, 0, moved);
      return next;
    });
    // Keep the preview pointed at a real image.
    setPreviewIndex((prev) => (prev === from ? to : prev));
  };

  const removeGalleryImage = async (index: number) => {
    const img = galleryImages[index];
    if (img?.id) {
      const baseUrl = API_BASE();
      const res = await fetch(`${baseUrl}/api/seller/products/images/${img.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(t("productForm.deleteImageFailed"));
        return;
      }
    }
    setGalleryImages((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Detail image upload (draft) ──────────────────────────────────────
  const handleDetailUpload = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 10 - detailImages.length);
    if (list.length === 0) return;
    setUploadingDetail(true);
    try {
      const results = await Promise.all(list.map((f) => draftUpload(draftId, f, "details")));
      setDetailImages((prev) => [...prev, ...results]);
      toast.success(t("productForm.uploadCountToast", { count: results.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("productForm.uploadFailed"));
    } finally { setUploadingDetail(false); }
  };

  const removeDetailImage = async (index: number) => {
    const img = detailImages[index];
    if (img?.id) {
      const baseUrl = API_BASE();
      const res = await fetch(`${baseUrl}/api/seller/products/images/${img.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(t("productForm.deleteImageFailed"));
        return;
      }
    }
    setDetailImages((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Option value image upload (draft) ──────────────────────────────
  const handleOptionImageUpload = async (groupIndex: number, valueIndex: number, file: File) => {
    const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!ACCEPT.includes(file.type)) { toast.error(t("productForm.variants.unsupportedFile")); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error(t("productForm.fileTooLarge")); return; }
    try {
      const img = await draftUpload(draftId, file, `options/${groupIndex}/${valueIndex}`);
      updateOptionValueImage(groupIndex, valueIndex, img.url);
      toast.success(t("productForm.optionImageUploaded"));
    } catch (err) {
      console.error("Option image upload error:", err);
      toast.error(err instanceof Error ? err.message : t("productForm.variants.uploadFailed"));
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
    if (!form.name.trim()) errors.push(t("productForm.errName"));
    if (categoriesLoading) errors.push(t("productForm.errCategoriesLoading"));
    else if (categoriesError) errors.push(t("productForm.errCategoriesLoad"));
    else if (!form.category) errors.push(t("productForm.errCategoryRequired"));
    else if (!categories.some((c) => c.slug === form.category)) errors.push(t("productForm.errCategoryUnavailable"));
    if (variantCount > 100) errors.push(t("productForm.errVariantLimit"));
    if (galleryImages.length === 0) errors.push(t("productForm.errGalleryRequired"));
    // Validate option values
    for (const group of optionGroups) {
      if (group.name.trim() && group.values.filter((v) => v.value.trim()).length < 2) {
        errors.push(t("productForm.errGroupValues", { name: group.name }));
      }
    }
    // Validate variants: each must have fullPrice > 0
    if (!isEdit && draftVariants.length > 0) {
      for (const v of draftVariants) {
        const fullPrice = Number(v.compareAtPrice);
        if (!v.compareAtPrice || !Number.isFinite(fullPrice) || fullPrice < 0) {
          errors.push(t("productForm.errVariantFullPrice", { name: v.name }));
        }
        const disc = Number(v.discountPercent);
        if (v.discountPercent && (!Number.isFinite(disc) || disc < 0 || disc > 100)) {
          errors.push(t("productForm.errVariantDiscount", { name: v.name }));
        }
        // AC-02: an explicitly negative stock is a validation error, not a
        // silent clamp (the create-full clamp stays as defense in depth).
        const stockNum = Number(v.stock);
        if (v.stock !== "" && (!Number.isFinite(stockNum) || stockNum < 0)) {
          errors.push(t("productForm.errStockNegative", { name: v.name }));
        }
      }
      const hasStock = draftVariants.some((v) => Number(v.stock) > 0);
      if (!hasStock) errors.push(t("productForm.errVariantStock"));
    }
    return errors;
  }, [form, galleryImages, current, optionGroups, draftVariants, isEdit, categories, categoriesError, categoriesLoading]);

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
          unit: form.unit.trim() || t("productForm.defaultUnit"),
          price: 0,
          description: form.description || undefined,
          supplier: form.supplier || undefined,
          status: form.published ? "published" : "draft",
          // Saves in the seller's chosen order; the shopfront renders the same.
          descriptionBlocks: blocks,
        } as any);
        if (updated) {
          // Product-level stock removed — variant stock is source of truth
          await saveOptions(current.id);
          // Persist only images that were added in this session; the ones that
          // already had an id are untouched by the product PATCH.
          const baseUrl = API_BASE();
          const pending = [
            ...pendingUploads(galleryImages).map((img) => ({ img, imageType: "gallery" as const })),
            ...pendingUploads(detailImages).map((img) => ({ img, imageType: "detail" as const })),
          ];
          for (const { img, imageType } of pending) {
            await fetch(`${baseUrl}/api/seller/products/save-image`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                productId: current.id,
                objectKey: img.objectKey || img.url,
                cdnUrl: img.url,
                alt: img.alt || "",
                imageType,
              }),
            }).catch(() => {});
          }

          // Re-read the product so the caller receives the authoritative image
          // list (old + newly saved), not just the PATCH payload.
          let fresh = updated;
          try {
            const detailRes = await fetch(`${baseUrl}/api/products/${current.id}`, { credentials: "include" });
            if (detailRes.ok) {
              const detailJson = await detailRes.json();
              fresh = detailJson.data ?? detailJson ?? updated;
            }
          } catch { /* keep the PATCH payload */ }

          // Re-seed from the server list so a second save cannot re-upload the
          // same images (they now carry ids) and the thumbnails show stored ones.
          const reseeded = seedGalleries((fresh as any)?.images);
          setGalleryImages(reseeded.gallery);
          setDetailImages(reseeded.detail);

          toast.success(t("productForm.savedToast"));
          setCurrent(fresh);
          onSaved?.(fresh);
        }
      } else {
        // NEW product: use create-full for atomic creation
        // Price is at variant level — use first variant's fullPrice for product.price (DB required)
        const firstFullPrice = draftVariants.length > 0 ? (Number(draftVariants[0].compareAtPrice) || 0) : 0;
        const payload: Record<string, any> = {
          product: {
            name: form.name.trim(),
            category: form.category,
            unit: form.unit.trim() || t("productForm.defaultUnit"),
            price: firstFullPrice,
            description: form.description || "",
            supplier: form.supplier || null,
            status: "pending_review",
            descriptionBlocks: blocks,
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
            // Send the real group/value selection (not positional index math) so
            // the backend links this variant to the option_value rows it inserts.
            const options: Record<string, string> = {};
            for (const sel of v.selections) {
              const groupName = sel.groupName.trim();
              const valueText = sel.valueText.trim();
              if (groupName && valueText) options[groupName] = valueText;
            }
            return {
              name: v.name,
              sku: v.sku || null,
              price: finalPrice,
              compareAtPrice: fullPrice || null,
              discountPercent: discPct || null,
              stock: Math.max(0, Number(v.stock) || 0),
              status: "active",
              options,
              images: v.images.map((img) => ({ url: img.url, alt: img.alt || v.name })),
            };
          }),
          attributes: attributes.filter((a) => a.name.trim() && a.value.trim()).map((a) => ({
            name: a.name.trim(),
            value: a.value.trim(),
          })),
        };

        // Featured variant: convert key to array index
        if (featuredVariantKey) {
          const fvIdx = draftVariants.findIndex((v) => v.key === featuredVariantKey);
          if (fvIdx >= 0) payload.product.featuredVariantIndex = fvIdx;
        }

        const created = await createFullProduct(payload);
        if (created) {
          toast.success(t("productForm.createdToast"));
          onSaved?.(created);
          onClose();
        }
      }
    } catch (error) {
      console.error("Product save error:", error);
      const message = error instanceof Error ? error.message : "";
      // Surface category failures as an actual category error, not a generic save failure.
      if (/categor/i.test(message)) {
        toast.error(t("productForm.errCategoryInvalid", { message }));
      } else {
        toast.error(message || t("productForm.errSaveFailed"));
      }
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
      {/* Category Picker — opens on top of this dialog */}
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        categories={categoryTree}
        value={form.category}
        onSelect={(slug) => set("category", slug)}
        loading={categoriesLoading}
      />
      <DialogHeader>
        <DialogTitle>{current ? t("productForm.editTitle") : t("productForm.createTitle")}</DialogTitle>
        <DialogDescription>
          {current ? t("productForm.editDesc", { name: current.name }) : t("productForm.createDesc", { shop: shop.name })}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-5">
        {/* ═══ Validation Errors ═══════════════════════════════════════ */}
        {validationErrors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-700">{t("productForm.fixErrors")}</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-red-600">
              {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        )}

        {/* ═══ Section 1: Product Info ═══════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("productForm.infoSection")}</h3>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-name">{t("productForm.nameLabel")}</Label>
              <Input id="p-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("productForm.namePlaceholder")} required />
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <div className="grid min-w-0 gap-2">
                <Label>{t("productForm.categoryLabel")}</Label>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  disabled={categoriesLoading || categoriesError}
                  title={selectedCategoryName ?? undefined}
                  className="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 text-left text-sm transition-colors hover:border-brand disabled:opacity-50"
                >
                  {categoriesLoading ? (
                    <span className="min-w-0 flex-1 truncate text-slate-400">{t("productForm.loadingCategories")}</span>
                  ) : selectedCategoryName ? (
                    <span className="min-w-0 flex-1 truncate text-slate-900 flex items-center gap-1">
                        <CategoryIcon name={selectedCategoryIconName} className="size-3.5 shrink-0" />{" "}
                        {selectedCategoryName}
                      </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-slate-400">{t("productForm.selectCategory")}</span>
                  )}
                  <ChevronDown className="size-4 shrink-0 text-slate-400" />
                </button>
                {categoriesError && (
                  <p className="text-2xs text-red-600">
                    {t("productForm.categoriesFailed")}{" "}
                    <button type="button" className="underline" onClick={() => void loadCategories()}>{t("productForm.retry")}</button>
                  </p>
                )}
              </div>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="p-unit">{t("productForm.unitLabel")}</Label>
                <Input id="p-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder={t("productForm.unitPlaceholder")} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-desc">{t("productForm.descLabel")}</Label>
              <Textarea id="p-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={t("productForm.descPlaceholder")} rows={2} />
            </div>
          </div>
        </div>

        {/* ═══ Rich description blocks ════════════════════════════════
            Words and pictures interleaved, in the seller's own order. A block
            image is uploaded as a DETAIL image, which is exactly what keeps it
            out of the gallery thumbnail strip. */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">รายละเอียดสินค้า</h3>
            <p className="text-xs text-slate-500">
              เพิ่มข้อความและรูปภาพสลับกันได้ตามต้องการ — รูปในส่วนนี้จะแสดงในหน้ารายละเอียดสินค้า ไม่ไปปนกับรูปสินค้าด้านบน
            </p>
          </div>
          <ProductDescriptionEditor
            blocks={blocks}
            onChange={setBlocks}
            onPickImage={async () => {
              const file = await pickImageFile();
              if (!file) return null;
              try {
                const uploaded = await draftUpload(draftId, file, "details");
                toast.success("อัปโหลดรูปในรายละเอียดแล้ว");
                return uploaded.url;
              } catch (err) {
                toast.error(err instanceof Error ? err.message : t("productForm.uploadFailed"));
                return null;
              }
            }}
            labels={{
            title: "รายละเอียดสินค้า",
            add: "เพิ่มบล็อก",
            empty: "ยังไม่มีบล็อก — เริ่มจากปุ่มด้านบน แล้วพิมพ์หรือเพิ่มรูปได้เลย",
            textPlaceholder: (type) => `พิมพ์${type}...`,
            imageHint: "คำอธิบายรูป (สำหรับผู้ใช้โปรแกรมอ่านหน้าจอ)",
            preview: "ดูตัวอย่าง",
            uploading: "กำลังอัปโหลด...",
          }}
          />
        </div>



        {/* ═══ Section 3: Option Groups ══════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <ListOrdered className="size-4 text-brand" />
            <h3 className="text-sm font-semibold text-slate-900">{t("productForm.optionsSection")}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("productForm.optionsDesc")}</p>

          {variantCount > 100 && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
              <p className="text-xs font-semibold text-red-700">{t("productForm.variantLimitWarn", { count: variantCount.toLocaleString() })}</p>
              <p className="mt-1 text-2xs text-red-500">{t("productForm.variantLimitHint")}</p>
            </div>
          )}

          <div className="mt-3 space-y-3">
            {optionGroups.map((group, gi) => (
              <div key={gi} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <Input value={group.name} onChange={(e) => updateGroupName(gi, e.target.value)} placeholder={t("productForm.groupNamePlaceholder")} className="h-8 text-sm" />
                  <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <button type="button" className={`px-2.5 py-1 text-2xs font-medium transition-colors ${group.displayType === "text" ? "bg-brand text-white" : "text-slate-500 hover:text-slate-700"}`} onClick={() => updateGroupDisplayType(gi, "text")}>{t("productForm.displayText")}</button>
                    <button type="button" className={`px-2.5 py-1 text-2xs font-medium transition-colors ${group.displayType === "image" ? "bg-brand text-white" : "text-slate-500 hover:text-slate-700"}`} onClick={() => updateGroupDisplayType(gi, "image")}>{t("productForm.displayImage")}</button>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-red-400 hover:text-red-600" onClick={() => removeOptionGroup(gi)} aria-label={t("productForm.removeGroupAria")}><X className="size-4" /></Button>
                </div>
                <div className="mt-2 space-y-2">
                  {group.values.map((val, vi) => (
                    <div key={vi} className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${val.isEnabled !== false ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/60 opacity-55"}`}>
                      <Checkbox
                        checked={val.isEnabled !== false}
                        onCheckedChange={(checked) => updateOptionValueEnabled(gi, vi, checked === true)}
                        className="shrink-0"
                      />
                      {group.displayType === "image" ? (
                        <>
                          {/* IMAGE group — image column on the left, details on the right */}
                          <div className="relative size-11 shrink-0">
                            <label className="flex size-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white text-slate-400 hover:border-brand hover:text-brand">
                              {val.imageUrl ? (
                                <img src={val.imageUrl} alt="" className="size-full object-cover" />
                              ) : (
                                <ImagePlus className="size-4" />
                              )}
                              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOptionImageUpload(gi, vi, f); e.target.value = ""; }} />
                            </label>
                            {val.imageUrl && (
                              <button type="button" className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600" onClick={() => updateOptionValueImage(gi, vi, null)} aria-label={t("productForm.removeValueImageAria")}><X className="size-2.5" /></button>
                            )}
                          </div>
                          <Input value={val.value} onChange={(e) => updateOptionValue(gi, vi, e.target.value)} placeholder={t("productForm.valuePlaceholder")} className="h-9 min-w-0 flex-1 text-xs" />
                          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeOptionValue(gi, vi)} aria-label={t("productForm.removeValueAria")}><X className="size-3.5" /></Button>
                        </>
                      ) : (
                        <>
                          {/* TEXT group — compact row, no image, no placeholder */}
                          <Input value={val.value} onChange={(e) => updateOptionValue(gi, vi, e.target.value)} placeholder={t("productForm.valuePlaceholder")} className="h-7 min-w-0 flex-1 text-xs" />
                          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeOptionValue(gi, vi)} aria-label={t("productForm.removeValueAria")}><X className="size-3.5" /></Button>
                        </>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-2xs text-slate-500 hover:text-slate-700" onClick={() => {
                      setOptionGroups((prev) => prev.map((g, i) => i === gi ? { ...g, values: g.values.map((v) => ({ ...v, isEnabled: true })) } : g));
                    }}>{t("productForm.selectAll")}</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-2xs text-slate-500 hover:text-slate-700" onClick={() => {
                      setOptionGroups((prev) => prev.map((g, i) => i === gi ? { ...g, values: g.values.map((v) => ({ ...v, isEnabled: false })) } : g));
                    }}>{t("productForm.clearAll")}</Button>
                    <div className="flex-1" />
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-xs text-brand" onClick={() => addOptionValue(gi)}><Plus className="size-3" />{t("productForm.addValue")}</Button>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed border-slate-300 text-sm text-slate-600" onClick={addOptionGroup}><Plus className="size-4" />{t("productForm.addGroup")}</Button>
          </div>

          {variantSummary && (
            <p className="mt-3 text-xs text-slate-500">{t("productForm.willCreate", { summary: variantSummary, count: variantCount })}</p>
          )}
        </div>

        {/* ═══ Section 4: Variants (auto-generated) ══════════════════ */}
        {!isEdit && draftVariants.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="size-4 text-brand" />
              <h3 className="text-sm font-semibold text-slate-900">Variants ({draftVariants.length})</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("productForm.variantDesc")}</p>

            <div className="mt-3 space-y-3 max-h-96 overflow-y-auto">
              {draftVariants.map((v) => (
                <div key={v.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-slate-900">{v.name}</p>
                    {Number(v.stock) <= 0 && <Badge className="text-2xs bg-red-50 text-red-600">{t("productForm.outOfStock")}</Badge>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-2xs">{t("productForm.fullPriceLabel")}</Label>
                      <Input type="number" min="0" step="0.5" value={v.compareAtPrice || v.price} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, compareAtPrice: e.target.value } : pv))} className="h-7 text-xs" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-2xs">{t("productForm.discountLabel")}</Label>
                      <Input type="number" min="0" max="100" value={v.discountPercent} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, discountPercent: e.target.value } : pv))} className="h-7 text-xs" placeholder="0" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-2xs">{t("productForm.stockLabel")}</Label>
                      <Input type="number" min="0" value={v.stock} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, stock: e.target.value } : pv))} className="h-7 text-xs" />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-2xs text-slate-500">{t("productForm.finalPrice")}</span>
                    <span className="text-xs font-bold text-brand">฿{(() => { const full = Number(v.compareAtPrice) || 0; const disc = Number(v.discountPercent) || 0; return Math.max(0, Math.round(full * (1 - disc / 100) * 100) / 100).toLocaleString(); })()}</span>
                    {Number(v.discountPercent) > 0 && <span className="rounded bg-red-50 px-1 py-0.5 text-2xs font-semibold text-red-600">-{Math.round(Number(v.discountPercent))}%</span>}
                  </div>
                  {draftVariants.length > 1 && (
                    <button type="button" className="mt-1.5 text-2xs text-blue-500 hover:text-blue-700" onClick={() => {
                      const first = draftVariants[0];
                      if (first) setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? pv : { ...pv, compareAtPrice: first.compareAtPrice, discountPercent: first.discountPercent }));
                    }}>{t("productForm.copyFromFirst")}</button>
                  )}
                  <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="featuredVariant"
                      className="accent-brand size-3.5"
                      checked={featuredVariantKey === v.key}
                      onChange={() => setFeaturedVariantKey(v.key)}
                    />
                    <span className="text-2xs text-slate-600">{t("productForm.featuredBadge")}</span>
                  </label>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-2xs">SKU</Label>
                      <Input value={v.sku} onChange={(e) => setDraftVariants((prev) => prev.map((pv) => pv.key === v.key ? { ...pv, sku: e.target.value } : pv))} className="h-7 text-xs" placeholder={t("productForm.skuPlaceholder")} />
                    </div>
                    <div className="col-span-3 grid gap-1">
                      <Label className="text-2xs">{t("productForm.valueImageLabel")}</Label>
                      <p className="text-2xs text-slate-400">{t("productForm.valueImageHint")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Section 5: Gallery Images ═════════════════════════════
            This editor IS the shopfront order: index 0 is the primary image the
            buyer sees first, and the rest fill the thumbnail column. Reordering
            here reorders the product, and the preview on the right renders the
            real VelShop gallery (same component, same vertical divider), so the
            seller never has to imagine what they are publishing. */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{t("productForm.gallerySection")}</h3>
              <p className="text-xs text-slate-500">{t("productForm.galleryHint")}</p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              {galleryImages.length} / 10
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            {/* Live preview — the same ProductGallery the shop renders. */}
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                ตัวอย่างหน้าร้าน
              </p>
              <ProductGallery
                images={galleryImages.map((img, i) => ({
                  id: img.id ?? `draft-${i}`,
                  url: img.url,
                }))}
                activeIndex={previewIndex}
                onIndexChange={setPreviewIndex}
                labels={{
                  mainImageAlt: form.name || "ตัวอย่างรูปสินค้า",
                  thumbAlt: (n) => `รูปที่ ${n}`,
                  prev: "รูปก่อนหน้า",
                  next: "รูปถัดไป",
                  noImage: "ยังไม่มีรูปสินค้า",
                }}
                thumbSize={52}
              />
            </div>

            {/* The editable grid: drag to reorder, star to make primary. */}
            <div>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                ลากเพื่อจัดลำดับ · ดาว = รูปหลัก (รูปแรก)
              </p>
              <div className="flex flex-wrap gap-2">
                {galleryImages.map((img, i) => {
                  const isPrimary = i === 0;
                  return (
                    <div
                      key={img.id ?? `new-${i}`}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(i));
                        setDragFrom(i);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const fromRaw = event.dataTransfer.getData("text/plain");
                        const from = fromRaw === "" ? dragFrom : Number(fromRaw);
                        setDragFrom(null);
                        if (from === null || Number.isNaN(from) || from === i) return;
                        moveGalleryImage(from, i);
                      }}
                      onDragEnd={() => setDragFrom(null)}
                      className={`group relative size-20 shrink-0 cursor-grab overflow-hidden rounded-lg border-2 bg-white active:cursor-grabbing ${
                        isPrimary ? "border-brand ring-1 ring-brand/20" : "border-slate-200"
                      } ${dragFrom === i ? "opacity-40" : ""}`}
                      title={isPrimary ? "รูปหลัก (แสดงเป็นรูปแรก)" : "ลากสลับตำแหน่ง"}
                    >
                      <img src={img.url} alt={img.alt || ""} className="size-full object-cover" loading="eager" draggable={false} />
                      {isPrimary && (
                        <span className="absolute left-1 top-1 rounded-full bg-brand px-1.5 py-0.5 text-2xs font-semibold text-white">
                          หลัก
                        </span>
                      )}
                      {/* Make primary = move to the front, which is exactly the
                          order the backend persists (sort_order 0). */}
                      <button
                        type="button"
                        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-slate-900/70 py-0.5 text-2xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => moveGalleryImage(i, 0)}
                        aria-label="ตั้งเป็นรูปหลัก"
                      >
                        <Star className="size-2.5" /> ตั้งเป็นหลัก
                      </button>
                      <button
                        type="button"
                        className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
                        aria-label={t("productForm.removeGalleryAria")}
                        onClick={() => void removeGalleryImage(i)}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
                {galleryImages.length < 10 && (
                  <label className="flex size-20 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-brand hover:text-brand">
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => { if (e.target.files) handleGalleryUpload(e.target.files); e.target.value = ""; }} />
                    {uploadingGallery ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
                  </label>
                )}
              </div>
              <p className="mt-2 text-2xs text-slate-400">
                รูปแรกคือรูปหลักที่ลูกค้าเห็นก่อน — ลากหรือกด “ตั้งเป็นหลัก” เพื่อเปลี่ยน
              </p>
            </div>
          </div>
        </div>

        {/* ═══ Section 6: Detail Images ══════════════════════════════ */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{t("productForm.detailSection")}</h3>
              <p className="text-xs text-slate-500">{t("productForm.detailHint")}</p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              {detailImages.length} / 10
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {detailImages.map((img, i) => (
              <div key={img.id ?? `new-detail-${i}`} className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-slate-200">
                <img src={img.url} alt={img.alt || ""} className="size-full object-cover" loading="eager" />
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
                  aria-label={t("productForm.removeDetailAria")}
                  onClick={() => void removeDetailImage(i)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {detailImages.length < 10 && (
              <label className="flex size-20 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-brand hover:text-brand">
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
            <h3 className="text-sm font-semibold text-slate-900">{t("productForm.attrSection")}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("productForm.attrHint")}</p>
          <div className="mt-3 space-y-2">
            {attributes.map((attr, ai) => (
              <div key={ai} className="flex items-center gap-2">
                <Input value={attr.name} onChange={(e) => updateAttribute(ai, "name", e.target.value)} placeholder={t("productForm.attrNamePlaceholder")} className="h-8 flex-1 text-sm" />
                <Input value={attr.value} onChange={(e) => updateAttribute(ai, "value", e.target.value)} placeholder={t("productForm.attrValuePlaceholder")} className="h-8 flex-1 text-sm" />
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-slate-400 hover:text-red-500" onClick={() => removeAttribute(ai)} aria-label={t("productForm.removeAttrAria")}><X className="size-4" /></Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full gap-1.5 border-dashed border-slate-300 text-sm text-slate-600" onClick={addAttribute}><Plus className="size-4" />{t("productForm.addAttr")}</Button>
            <p className="mt-2 text-xs text-slate-400">
              ตัวอย่าง: แบรนด์ = Nike · วัสดุ = ผ้าฝ้าย · สี = ขาว · ขนาด = L
            </p>
          </div>
        </div>

        {/* ═══ Section 9: Edit Mode — Variant Manager (existing products) ═══ */}
        {isEdit && current && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">{t("productForm.manageVariants")}</h3>
            <p className="mb-2 text-xs text-slate-500">{t("productForm.manageVariantsHint")}</p>
            <VariantManager productId={current.id} price={current.price} />
          </div>
        )}

        {/* ═══ Section 10: Submit ════════════════════════════════════ */}
        <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5">
          <Store className="size-4 shrink-0 text-brand" />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900">
              {isEdit ? t("productForm.submitEdit") : t("productForm.submitCreate")}
            </p>
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button type="button" variant="outline" className="border-slate-200 text-slate-700" onClick={onClose} disabled={saving}>
            {current && !isEdit ? t("productForm.close") : t("common.cancel")}
          </Button>
          {(isEdit || !current) && (
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? t("productForm.submitEdit") : t("productForm.submitCreateShort")}
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
