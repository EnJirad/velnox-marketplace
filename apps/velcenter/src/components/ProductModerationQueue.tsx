import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
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
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { VerificationStatusLabel } from "@velnox/shared/components/VBadge";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { formatBaht } from "@velnox/shared/lib/shop";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  ImageOff,
  Loader2,
  Package,
  Search,
  Store,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface ModProduct {
  id: string;
  name: string;
  description?: string;
  price: string;
  compare_at_price?: string;
  currency: string;
  unit: string;
  status: string;
  rejection_reason?: string;
  category_id?: string;
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  shop_status?: string;
  seller_name: string;
  seller_email: string;
  seller_verification_status?: string;
  created_at: string;
  updated_at: string;
  inventory_quantity?: number;
  inventory_reserved?: number;
  primaryImage?: { id: string; url: string; alt: string } | null;
  images?: { id: string; url: string; alt: string }[];
}

interface ShopGroup {
  shopId: string;
  shopName: string;
  shopSlug: string;
  shopStatus?: string;
  sellerName: string;
  sellerEmail: string;
  sellerVerificationStatus?: string;
  products: ModProduct[];
  latestSubmission: string;
  expanded: boolean;
}

interface ProductDetail {
  product: {
    id: string; name: string; description: string; short_description?: string;
    price: number; compare_at_price?: number; currency: string; unit: string;
    status: string; rejection_reason?: string; category_id?: string;
    category_name?: string; created_at: string; updated_at: string;
  };
  images: { id: string; url: string; alt: string; sort_order: number; image_type: string }[];
  primaryImage?: { id: string; url: string; alt: string } | null;
  variants: { id: string; name: string; sku?: string; price: number; stock: number; status: string; options: Record<string, string>; images: { id: string; url: string; alt?: string }[] }[];
  optionGroups: { id: string; name: string; display_type: string; required: boolean; values: { id: string; value: string; label: string }[] }[];
  attributes: { id: string; name: string; value: string }[];
  inventory: { quantity: number; reserved: number; reorder_level: number };
  shop: { id: string; name: string; slug: string; status: string; description?: string; logo?: string; seller_name: string; seller_email: string; seller_verification_status?: string; seller_verified_at?: string };
  moderationHistory: { id: string; action: string; reason?: string; moderator_name?: string; created_at: string }[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_review: { label: "รอตรวจสอบ", color: "bg-amber-100 text-amber-700 ring-amber-600/15" },
  published: { label: "เผยแพร่แล้ว", color: "bg-emerald-100 text-emerald-700 ring-emerald-600/15" },
  rejected: { label: "ปฏิเสธ", color: "bg-rose-100 text-rose-700 ring-rose-600/15" },
  draft: { label: "ร่าง", color: "bg-slate-100 text-slate-600 ring-slate-600/10" },
  suspended: { label: "ระงับ", color: "bg-orange-100 text-orange-700 ring-orange-600/15" },
  archived: { label: "เก็บถาวร", color: "bg-slate-100 text-slate-500 ring-slate-600/10" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABELS[status] ?? { label: status, color: "bg-slate-100 text-slate-600 ring-slate-600/10" };
  return (
    <Badge className={`gap-1 rounded-full text-[10px] font-medium ring-1 ring-inset ${meta.color}`}>
      {meta.label}
    </Badge>
  );
}

function ImageGallery({ images, primaryImage }: { images: { id: string; url: string; alt: string }[]; primaryImage?: { id: string; url: string; alt?: string } | null }) {
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(false);
  const allImages = images.length > 0 ? images : primaryImage ? [{ ...primaryImage, alt: primaryImage.alt ?? "" }] : [];
  if (allImages.length === 0) return (
    <div className="flex aspect-square items-center justify-center rounded-xl bg-slate-50">
      <ImageOff className="size-8 text-slate-300" />
    </div>
  );
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <button type="button" onClick={() => setZoom(true)} className="block w-full">
          <img src={allImages[selected].url} alt={allImages[selected].alt} className="aspect-square w-full object-contain bg-slate-50" />
        </button>
      </div>
      {allImages.length > 1 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {allImages.map((img, i) => (
            <button key={img.id} type="button" onClick={() => setSelected(i)} className={`shrink-0 size-14 overflow-hidden rounded-lg border-2 transition-colors ${i === selected ? "border-[#10B981]" : "border-slate-200 hover:border-slate-300"}`}>
              <img src={img.url} alt={img.alt} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={() => setZoom(false)}>
          <button type="button" onClick={() => setZoom(false)} className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/30">
            <X className="size-4" />
          </button>
          <img src={allImages[selected].url} alt={allImages[selected].alt} className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

export default function ProductModerationQueue() {
  const { t } = useLanguage();
  const moderationAction = useAction(api.centerAdmin.productModerationList);
  const detailAction = useAction(api.centerAdmin.productModerationDetail);
  const setModerationStatus = useAction(api.centerAdmin.setProductModerationStatus);

  const [products, setProducts] = useState<ModProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [sortOrder, setSortOrder] = useState("newest");
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set());

  // Detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moderationAction2, setModerationAction2] = useState<"approve" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await moderationAction({
        status: statusFilter === "all" ? undefined : statusFilter,
        q: search || undefined,
        sort: sortOrder,
      });
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [moderationAction, statusFilter, search, sortOrder]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const shopGroups = useMemo(() => {
    const groups = new Map<string, ShopGroup>();
    for (const p of products) {
      const key = p.shop_id;
      if (!groups.has(key)) {
        groups.set(key, {
          shopId: key, shopName: p.shop_name, shopSlug: p.shop_slug,
          shopStatus: p.shop_status, sellerName: p.seller_name, sellerEmail: p.seller_email,
          sellerVerificationStatus: p.seller_verification_status,
          products: [], latestSubmission: p.created_at, expanded: expandedShops.has(key),
        });
      }
      const g = groups.get(key)!;
      g.products.push(p);
      if (p.created_at > g.latestSubmission) g.latestSubmission = p.created_at;
    }
    return Array.from(groups.values()).sort((a, b) => b.latestSubmission.localeCompare(a.latestSubmission));
  }, [products, expandedShops]);

  const toggleShop = useCallback((shopId: string) => {
    setExpandedShops(prev => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId); else next.add(shopId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedShops(new Set(shopGroups.map(g => g.shopId)));
  }, [shopGroups]);

  const collapseAll = useCallback(() => { setExpandedShops(new Set()); }, []);

  const openDetail = useCallback(async (product: ModProduct) => {
    setDetailLoading(true);
    setDetailOpen(true);
    setModerationAction2(null);
    setRejectReason("");
    try {
      const data = await detailAction({ productId: product.id });
      setDetailProduct(data as unknown as ProductDetail);
    } catch {
      setDetailProduct(null);
      toast.error("ไม่สามารถโหลดรายละเอียดสินค้าได้");
    } finally {
      setDetailLoading(false);
    }
  }, [detailAction]);

  const handleModeration = useCallback(async () => {
    if (!detailProduct || !moderationAction2) return;
    setActing(true);
    try {
      await setModerationStatus({
        productId: detailProduct.product.id,
        status: moderationAction2 === "approve" ? "published" : "rejected",
        rejectionReason: moderationAction2 === "reject" ? rejectReason.trim() : undefined,
      });
      toast.success(moderationAction2 === "approve" ? "อนุมัติสินค้าแล้ว 🛍️" : "ปฏิเสธสินค้าแล้ว");
      setDetailOpen(false);
      setDetailProduct(null);
      void loadProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setActing(false);
    }
  }, [detailProduct, moderationAction2, rejectReason, setModerationStatus, loadProducts]);

  const pendingCount = products.filter(p => p.status === "pending_review").length;

  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาสินค้า, ร้านค้า, ผู้ขาย..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-[10px]"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
          >
            <option value="pending_review">รอตรวจสอบ</option>
            <option value="all">ทั้งหมด</option>
            <option value="published">เผยแพร่แล้ว</option>
            <option value="rejected">ปฏิเสธ</option>
            <option value="draft">ร่าง</option>
            <option value="suspended">ระงับ</option>
          </select>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="h-9 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
          >
            <option value="newest">ใหม่สุด</option>
            <option value="oldest">เก่าสุด</option>
          </select>
          <Button variant="outline" size="sm" onClick={expandAll} className="rounded-[10px]">
            <ChevronDown className="size-3.5" /> ขยายทั้งหมด
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll} className="rounded-[10px]">
            <ChevronRight className="size-3.5" /> ย่อทั้งหมด
          </Button>
        </div>
      </div>

      {/* Pending count */}
      {statusFilter === "pending_review" && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Package className="size-4" />
          <span className="font-medium">{pendingCount} สินค้ารอตรวจสอบ</span>
        </div>
      )}

      {/* Shop groups */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : shopGroups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
            <Package className="size-7 text-[#10B981]" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-slate-900">ไม่มีสินค้า</h3>
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">
            {statusFilter === "pending_review" ? "ไม่มีสินค้ารอตรวจสอบในขณะนี้" : "ไม่พบสินค้าตามเงื่อนไขที่เลือก"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shopGroups.map((group) => (
            <Card key={group.shopId} className="border-slate-200 shadow-none">
              <button
                type="button"
                onClick={() => toggleShop(group.shopId)}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Store className="size-4 shrink-0 text-[#10B981]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{group.shopName}</p>
                    <p className="truncate text-xs text-slate-400">{group.sellerName} · {group.sellerEmail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {group.sellerVerificationStatus === "verified" && (
                    <Badge className="rounded-full bg-emerald-50 text-emerald-700 text-[10px] ring-1 ring-inset ring-emerald-600/15">V ✓</Badge>
                  )}
                  <Badge className="rounded-full bg-amber-100 text-amber-700 text-[10px] ring-1 ring-inset ring-amber-600/15">
                    {group.products.length} สินค้า
                  </Badge>
                  {expandedShops.has(group.shopId) ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                </div>
              </button>

              {expandedShops.has(group.shopId) && (
                <CardContent className="border-t border-slate-100 px-4 pt-3 pb-3">
                  <div className="space-y-2">
                    {group.products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => void openDetail(product)}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 text-left transition-all hover:border-slate-200 hover:shadow-sm"
                      >
                        {product.primaryImage ? (
                          <img src={product.primaryImage.url} alt={product.name} className="size-12 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                            <Package className="size-5 text-slate-300" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{product.name}</p>
                          <p className="text-xs text-slate-400">{formatBaht(parseFloat(product.price))} · {product.unit}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge status={product.status} />
                          <Clock className="size-3.5 text-slate-300" />
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Product Detail Review Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-5xl overflow-y-auto p-0 sm:w-full">
          <DialogHeader className="border-b border-slate-100 px-4 py-4 sm:px-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Package className="size-4 shrink-0 text-[#10B981]" />
              <span className="min-w-0 flex-1 truncate">ตรวจสอบสินค้า</span>
              {detailProduct && <StatusBadge status={detailProduct.product.status} />}
            </DialogTitle>
            <DialogDescription className="text-xs">ตรวจสอบรายละเอียดสินค้าและดำเนินการตรวจสอบ</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" /> กำลังโหลด...
            </div>
          ) : !detailProduct ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <AlertCircle className="size-6 text-rose-400" />
              <p className="text-sm text-rose-600">ไม่สามารถโหลดรายละเอียดได้</p>
            </div>
          ) : (
            <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-2">
              {/* LEFT: product info */}
              <div className="space-y-4">
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Package className="size-3.5" /> ข้อมูลสินค้า
                  </h4>
                  <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {[
                      { label: "ชื่อสินค้า", value: detailProduct.product.name },
                      { label: "ราคา", value: `${formatBaht(detailProduct.product.price)} / ${detailProduct.product.unit}` },
                      detailProduct.product.compare_at_price ? { label: "ราคาเปรียบเทียบ", value: formatBaht(detailProduct.product.compare_at_price) } : null,
                      { label: "หมวดหมู่", value: detailProduct.product.category_name ?? detailProduct.product.category_id ?? "—" },
                      { label: "สต็อก", value: `${detailProduct.inventory.quantity} (สงวน ${detailProduct.inventory.reserved})` },
                      { label: "สร้างเมื่อ", value: new Date(detailProduct.product.created_at).toLocaleString() },
                      { label: "อัปเดตล่าสุด", value: new Date(detailProduct.product.updated_at).toLocaleString() },
                    ].filter(Boolean).map((item) => (
                      <div key={item!.label} className="flex items-start justify-between gap-3 px-3 py-2">
                        <dt className="shrink-0 text-xs text-slate-400">{item!.label}</dt>
                        <dd className="min-w-0 flex-1 truncate text-right text-sm text-slate-700" title={item!.value}>{item!.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                {detailProduct.product.description && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">รายละเอียดสินค้า</h4>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600 whitespace-pre-wrap">
                      {detailProduct.product.description}
                    </div>
                  </section>
                )}

                {/* Attributes */}
                {detailProduct.attributes.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">คุณสมบัติ</h4>
                    <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {detailProduct.attributes.map((attr) => (
                        <div key={attr.id} className="flex items-start justify-between gap-3 px-3 py-2">
                          <dt className="shrink-0 text-xs text-slate-400">{attr.name}</dt>
                          <dd className="min-w-0 flex-1 truncate text-right text-sm text-slate-700">{attr.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}

                {/* Variants */}
                {detailProduct.variants.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">ตัวเลือกสินค้า</h4>
                    <div className="space-y-2">
                      {detailProduct.variants.map((v) => (
                        <div key={v.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-slate-900">{v.name}</p>
                            <StatusBadge status={v.status} />
                          </div>
                          <div className="mt-1 flex gap-4 text-xs text-slate-500">
                            <span>{formatBaht(v.price)}</span>
                            <span>สต็อก: {v.stock}</span>
                            {v.sku && <span>SKU: {v.sku}</span>}
                          </div>
                          {v.options && Object.keys(v.options).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Object.entries(v.options).map(([k, val]) => (
                                <Badge key={k} className="rounded-full bg-slate-100 text-slate-600 text-[10px]">{k}: {val}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Shop info */}
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Store className="size-3.5" /> ข้อมูลร้านค้า
                  </h4>
                  <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {[
                      { label: "ชื่อร้าน", value: detailProduct.shop.name },
                      { label: "ผู้ขาย", value: detailProduct.shop.seller_name },
                      { label: "Email", value: detailProduct.shop.seller_email },
                      { label: "สถานะร้าน", value: detailProduct.shop.status },
                      { label: "การยืนยัน", value: detailProduct.shop.seller_verification_status ?? "—" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start justify-between gap-3 px-3 py-2">
                        <dt className="shrink-0 text-xs text-slate-400">{item.label}</dt>
                        <dd className="min-w-0 flex-1 truncate text-right text-sm text-slate-700">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                {/* Moderation history */}
                {detailProduct.moderationHistory.length > 0 && (
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">ประวัติการตรวจสอบ</h4>
                    <ol className="space-y-1.5">
                      {detailProduct.moderationHistory.map((h) => (
                        <li key={h.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-700">{h.action}</span>
                            <span className="text-[10px] text-slate-400">{new Date(h.created_at).toLocaleDateString()}</span>
                          </div>
                          {h.reason && <p className="mt-0.5 text-[11px] text-slate-500">{h.reason}</p>}
                          {h.moderator_name && <p className="mt-0.5 text-[10px] text-slate-400">— {h.moderator_name}</p>}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </div>

              {/* RIGHT: images + actions */}
              <div className="space-y-4">
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">รูปภาพสินค้า</h4>
                  <ImageGallery images={detailProduct.images} primaryImage={detailProduct.primaryImage} />
                </section>

                {detailProduct.product.rejection_reason && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                    <p className="text-xs font-medium text-rose-700">เหตุผลที่ปฏิเสธ:</p>
                    <p className="mt-1 text-sm text-rose-600">{detailProduct.product.rejection_reason}</p>
                  </div>
                )}

                {/* Moderation actions */}
                {detailProduct.product.status === "pending_review" && (
                  <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">ดำเนินการ</h4>
                    {!moderationAction2 ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setModerationAction2("approve")} disabled={acting}>
                          <CheckCircle2 className="size-4" /> อนุมัติ
                        </Button>
                        <Button variant="outline" className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50" onClick={() => setModerationAction2("reject")} disabled={acting}>
                          ปฏิเสธ
                        </Button>
                      </div>
                    ) : moderationAction2 === "approve" ? (
                      <div className="space-y-2">
                        <p className="text-xs text-slate-600">ยืนยันการอนุมัติสินค้านี้?</p>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setModerationAction2(null)} disabled={acting}>ยกเลิก</Button>
                          <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void handleModeration()} disabled={acting}>
                            {acting && <Loader2 className="size-3.5 animate-spin" />} ยืนยันอนุมัติ
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid gap-2">
                          <Label className="text-xs font-medium text-slate-500">เหตุผลที่ปฏิเสธ *</Label>
                          <Textarea
                            rows={3}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="กรุณาระบุเหตุผลที่ปฏิเสธสินค้า..."
                            className="rounded-[10px] border-slate-200 bg-white text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => { setModerationAction2(null); setRejectReason(""); }} disabled={acting}>ยกเลิก</Button>
                          <Button size="sm" className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleModeration()} disabled={acting || !rejectReason.trim()}>
                            {acting && <Loader2 className="size-3.5 animate-spin" />} ยืนยันปฏิเสธ
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-slate-100 px-4 py-3 sm:px-6">
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setDetailOpen(false)}>ปิด</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
