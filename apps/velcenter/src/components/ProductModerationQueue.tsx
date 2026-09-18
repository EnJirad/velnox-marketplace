import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent } from "@velnox/shared/components/ui/card";
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
import { VBadge } from "@velnox/shared/components/VBadge";
import type { VerificationStatus } from "@velnox/shared/lib/commerce";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { formatBaht } from "@velnox/shared/lib/shop";
import { cn } from "@velnox/shared/lib/utils";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  History,
  ImageOff,
  Layers,
  Loader2,
  Package,
  Search,
  Store,
  Tag,
  Truck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { onCenterEvent } from "../lib/center-events";

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
    <Badge className={`shrink-0 gap-1 rounded-full text-[10px] font-medium ring-1 ring-inset ${meta.color}`}>
      {meta.label}
    </Badge>
  );
}

/** The Velnox verification mark is the letter V and nothing else. */
function SellerVMark({ status, size = "md" }: { status?: string | null; size?: "sm" | "md" | "lg" }) {
  if (status !== "verified") return null;
  return (
    <VBadge
      sellerOnly
      size={size}
      sellerVerification={status as VerificationStatus}
    />
  );
}

/**
 * Section wrapper for the inspection workspace.
 *
 * `collapsible` turns the heading into a disclosure on phones only, so a long
 * inspection stays short on a small screen while the desktop layout keeps every
 * panel open. The body is always visible from `lg` up (`lg:block`), and the
 * collapsed state still shows a count, so nothing can be hidden unnoticed.
 */
function Section({
  title,
  icon,
  children,
  className = "",
  collapsible = false,
  count,
  defaultOpen = false,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  count?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const heading = (
    <>
      {icon}
      <span className="truncate">{title}</span>
      {typeof count === "number" && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          {count}
        </span>
      )}
      {collapsible && (
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 text-slate-400 transition-transform lg:hidden",
            !open && "-rotate-90",
          )}
        />
      )}
    </>
  );

  return (
    <section className={className}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="mb-2 flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 lg:pointer-events-none"
        >
          {heading}
        </button>
      ) : (
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {heading}
        </h4>
      )}
      <div className={cn(collapsible && !open && "hidden", "lg:block")}>{children}</div>
    </section>
  );
}

/** Key/value rows (label left, value right, wrapping on narrow screens). */
function InfoRows({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-3 px-3 py-2">
          <dt className="shrink-0 text-xs text-slate-400">{row.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-right text-sm text-slate-700">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Inspection gallery.
 *
 * The stage is height-bounded on EVERY breakpoint so a tall photo can never
 * decide the dialog height: ~30dvh (max 240px) on phones, a fixed 420px stage
 * from `sm` up. Thumbnails scroll horizontally with snap.
 */
function ImageGallery({ images, primaryImage }: { images: { id: string; url: string; alt: string }[]; primaryImage?: { id: string; url: string; alt?: string } | null }) {
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(false);
  const allImages = images.length > 0 ? images : primaryImage ? [{ ...primaryImage, alt: primaryImage.alt ?? "" }] : [];
  const active = allImages[selected];

  if (allImages.length === 0) {
    return (
      <div className="flex h-[26dvh] max-h-44 min-h-32 items-center justify-center rounded-xl bg-slate-50 sm:h-64 sm:max-h-none">
        <div className="flex flex-col items-center gap-1.5 text-slate-300">
          <ImageOff className="size-8" />
          <span className="text-xs">ไม่มีรูปภาพ</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-[30dvh] max-h-60 min-h-36 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:h-[420px] sm:max-h-none">
        <button type="button" onClick={() => setZoom(true)} className="flex size-full items-center justify-center">
          <img src={active.url} alt={active.alt} className="max-h-full max-w-full object-contain" />
        </button>
      </div>
      {allImages.length > 1 && (
        <div className="mt-2 flex snap-x gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
          {allImages.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setSelected(i)}
              aria-label={`รูปที่ ${i + 1}`}
              className={`size-14 shrink-0 snap-start overflow-hidden rounded-lg border-2 transition-colors sm:size-16 ${i === selected ? "border-[#10B981]" : "border-slate-200 hover:border-slate-300"}`}
            >
              <img src={img.url} alt={img.alt} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={() => setZoom(false)}>
          <button type="button" onClick={() => setZoom(false)} className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/30" aria-label="ปิด">
            <X className="size-4" />
          </button>
          <img src={active.url} alt={active.alt} className="max-h-[88dvh] max-w-[92vw] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

/**
 * Product identity block — the first thing a reviewer needs on a phone:
 * name, verification mark, shop, status, price and category, before any long
 * section. Duplicates nothing: the same fields are also listed as rows below.
 */
function ProductSummaryCard({ detail }: { detail: ProductDetail }) {
  const category = detail.product.category_name ?? detail.product.category_id;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-base font-semibold leading-6 text-slate-900">
          {detail.product.name}
        </p>
        <StatusBadge status={detail.product.status} />
      </div>
      <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
        <Store className="size-3.5 shrink-0 text-slate-400" />
        <span className="truncate">{detail.shop.name}</span>
        <SellerVMark status={detail.shop.seller_verification_status} size="sm" />
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400">ราคา</p>
          <p className="text-xl font-bold tabular-nums text-slate-900">
            {formatBaht(detail.product.price)}
            <span className="ml-1 text-xs font-normal text-slate-400">/ {detail.product.unit}</span>
          </p>
          {detail.product.compare_at_price ? (
            <p className="text-[11px] text-slate-400 line-through">{formatBaht(detail.product.compare_at_price)}</p>
          ) : null}
        </div>
        <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
          <Tag className="size-3 shrink-0" />
          {category ?? "ไม่ระบุหมวดหมู่"}
        </span>
      </div>
    </div>
  );
}

function StockGrid({ inventory }: { inventory: ProductDetail["inventory"] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <p className="text-[11px] text-slate-400">คงเหลือ</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{inventory.quantity}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <p className="text-[11px] text-slate-400">สงวนไว้</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{inventory.reserved}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <p className="text-[11px] text-slate-400">จุดสั่งซื้อซ้ำ</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{inventory.reorder_level}</p>
      </div>
    </div>
  );
}

function ShopCard({ shop }: { shop: ProductDetail["shop"] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        {shop.logo ? (
          <img src={shop.logo} alt={shop.name} className="size-11 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Store className="size-5 text-slate-400" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <span className="truncate">{shop.name}</span>
            <SellerVMark status={shop.seller_verification_status} size="sm" />
          </p>
          <p className="truncate text-xs text-slate-400">/{shop.slug}</p>
        </div>
      </div>
      {shop.description && (
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{shop.description}</p>
      )}
      <div className="mt-3 grid gap-1.5 border-t border-slate-100 pt-3 text-xs">
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-slate-400">ผู้ขาย</span>
          <span className="min-w-0 truncate text-right text-slate-700">{shop.seller_name}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-slate-400">อีเมล</span>
          <span className="min-w-0 truncate text-right text-slate-700">{shop.seller_email}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-slate-400">สถานะร้าน</span>
          <span className="text-right text-slate-700">{shop.status}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-slate-400">การยืนยัน</span>
          <span className="text-right text-slate-700">
            {shop.seller_verification_status ?? "—"}
            {shop.seller_verified_at
              ? ` · ${new Date(shop.seller_verified_at).toLocaleDateString()}`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function ModerationHistoryList({ history }: { history: ProductDetail["moderationHistory"] }) {
  return (
    <ol className="space-y-1.5">
      {history.map((h) => (
        <li key={h.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs font-medium text-slate-700">{h.action}</span>
            <span className="shrink-0 text-[10px] text-slate-400">{new Date(h.created_at).toLocaleDateString()}</span>
          </div>
          {h.reason && <p className="mt-0.5 break-words text-[11px] text-slate-500">{h.reason}</p>}
          {h.moderator_name && <p className="mt-0.5 text-[10px] text-slate-400">— {h.moderator_name}</p>}
        </li>
      ))}
    </ol>
  );
}

function OptionGroupsList({ groups }: { groups: ProductDetail["optionGroups"] }) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium text-slate-900">{group.name}</p>
            <Badge className="rounded-full bg-slate-100 text-[10px] text-slate-600 ring-1 ring-inset ring-slate-600/10">
              {group.display_type}
            </Badge>
            {group.required && (
              <Badge className="rounded-full bg-amber-50 text-[10px] text-amber-700 ring-1 ring-inset ring-amber-600/15">
                จำเป็น
              </Badge>
            )}
          </div>
          {group.values.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {group.values.map((v) => (
                <Badge key={v.id} className="rounded-full bg-slate-50 text-[10px] text-slate-600 ring-1 ring-inset ring-slate-200">
                  {v.label || v.value}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-slate-400">ไม่มีค่าตัวเลือก</p>
          )}
        </div>
      ))}
    </div>
  );
}

function VariantList({ variants }: { variants: ProductDetail["variants"] }) {
  return (
    <>
      {/* Desktop: table. Mobile: stacked cards — no horizontal scrolling. */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-3 py-2 font-medium">ภาพ</th>
              <th className="px-3 py-2 font-medium">ชื่อ</th>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 text-right font-medium">ราคา</th>
              <th className="px-3 py-2 text-right font-medium">สต็อก</th>
              <th className="px-3 py-2 text-right font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2">
                  {v.images && v.images.length > 0 ? (
                    <div className="flex -space-x-1">
                      {v.images.slice(0, 3).map((img) => (
                        <img key={img.id} src={img.url} alt={img.alt || v.name} className="size-8 rounded-md border border-white object-cover" />
                      ))}
                      {v.images.length > 3 && (
                        <span className="flex size-8 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-500">+{v.images.length - 3}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-300">ไม่มีรูป</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-900">{v.name}</span>
                  {Object.keys(v.options ?? {}).length > 0 && (
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {Object.entries(v.options).map(([k, val]) => `${k}: ${val}`).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{v.sku ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatBaht(v.price)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{v.stock}</td>
                <td className="px-3 py-2 text-right"><StatusBadge status={v.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {variants.map((v) => (
          <div key={v.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-3">
              {v.images && v.images.length > 0 ? (
                <img src={v.images[0].url} alt={v.images[0].alt || v.name} className="size-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">ไม่มีรูป</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900">{v.name}</p>
                  <StatusBadge status={v.status} />
                </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div className="min-w-0">
                <p className="text-slate-400">ราคา</p>
                <p className="mt-0.5 truncate font-semibold tabular-nums text-slate-900">{formatBaht(v.price)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-slate-400">สต็อก</p>
                <p className="mt-0.5 font-semibold tabular-nums text-slate-900">{v.stock}</p>
              </div>
              <div className="min-w-0">
                <p className="text-slate-400">SKU</p>
                <p className="mt-0.5 truncate font-mono text-slate-600">{v.sku ?? "—"}</p>
              </div>
            </div>
              </div>
            </div>
            {Object.keys(v.options ?? {}).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(v.options).map(([k, val]) => (
                  <Badge key={k} className="rounded-full bg-slate-50 text-[10px] text-slate-600 ring-1 ring-inset ring-slate-200">
                    {k}: {val}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default function ProductModerationQueue() {
  const moderationAction = useAction(api.centerAdmin.productModerationList);
  const detailAction = useAction(api.centerAdmin.productModerationDetail);
  const setModerationStatus = useAction(api.centerAdmin.setProductModerationStatus);

  const [products, setProducts] = useState<ModProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [sortOrder, setSortOrder] = useState("newest");
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set());

  // Detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [moderationChoice, setModerationChoice] = useState<"approve" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await moderationAction({
        status: statusFilter === "all" ? undefined : statusFilter,
        q: search || undefined,
        sort: sortOrder,
      });
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการโหลดข้อมูล";
      setError(msg);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [moderationAction, statusFilter, search, sortOrder]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  // Realtime: the Center page owns the WebSocket and notifies us when the
  // product queue changed, so a reviewed item leaves the list immediately.
  useEffect(() => onCenterEvent("products", () => { void loadProducts(); }), [loadProducts]);

  const shopGroups = useMemo(() => {
    const groups = new Map<string, ShopGroup>();
    for (const p of products) {
      const key = p.shop_id;
      if (!groups.has(key)) {
        groups.set(key, {
          shopId: key, shopName: p.shop_name, shopSlug: p.shop_slug,
          shopStatus: p.shop_status, sellerName: p.seller_name, sellerEmail: p.seller_email,
          sellerVerificationStatus: p.seller_verification_status,
          products: [], latestSubmission: p.created_at,
        });
      }
      const g = groups.get(key)!;
      g.products.push(p);
      if (p.created_at > g.latestSubmission) g.latestSubmission = p.created_at;
    }
    return Array.from(groups.values()).sort((a, b) => b.latestSubmission.localeCompare(a.latestSubmission));
  }, [products]);

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

  const loadDetail = useCallback(async (productId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await detailAction({ productId });
      setDetailProduct(data as unknown as ProductDetail);
    } catch (err) {
      setDetailProduct(null);
      setDetailError(err instanceof Error ? err.message : "ไม่สามารถโหลดรายละเอียดสินค้าได้");
    } finally {
      setDetailLoading(false);
    }
  }, [detailAction]);

  const openDetail = useCallback(async (product: ModProduct) => {
    setDetailOpen(true);
    setDetailProductId(product.id);
    setDetailProduct(null);
    setModerationChoice(null);
    setRejectReason("");
    await loadDetail(product.id);
  }, [loadDetail]);

  const handleModeration = useCallback(async () => {
    if (!detailProduct || !moderationChoice) return;
    setActing(true);
    try {
      await setModerationStatus({
        productId: detailProduct.product.id,
        status: moderationChoice === "approve" ? "published" : "rejected",
        rejectionReason: moderationChoice === "reject" ? rejectReason.trim() : undefined,
      });
      toast.success(moderationChoice === "approve" ? "อนุมัติสินค้าแล้ว 🛍️" : "ปฏิเสธสินค้าแล้ว");
      setDetailOpen(false);
      setDetailProduct(null);
      void loadProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setActing(false);
    }
  }, [detailProduct, moderationChoice, rejectReason, setModerationStatus, loadProducts]);

  const pendingCount = products.filter(p => p.status === "pending_review").length;
  const isPending = detailProduct?.product.status === "pending_review";

  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาสินค้า, ร้านค้า, ผู้ขาย..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-[10px] pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="กรองตามสถานะสินค้า"
            className="h-9 flex-1 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40 sm:flex-none"
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
            aria-label="เรียงลำดับ"
            className="h-9 flex-1 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40 sm:flex-none"
          >
            <option value="newest">ใหม่สุด</option>
            <option value="oldest">เก่าสุด</option>
          </select>
          <Button variant="outline" size="sm" onClick={expandAll} className="rounded-[10px]">
            <ChevronDown className="size-3.5" /> ขยาย
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll} className="rounded-[10px]">
            <ChevronRight className="size-3.5" /> ย่อ
          </Button>
        </div>
      </div>

      {/* Pending count */}
      {statusFilter === "pending_review" && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <Package className="size-4 shrink-0" />
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
      ) : error ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-red-300 bg-red-50/50 px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-red-100">
            <AlertCircle className="size-7 text-red-500" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-slate-900">เกิดข้อผิดพลาด</h3>
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void loadProducts()} className="mt-4 rounded-[10px]">
            ลองใหม่
          </Button>
        </div>
      ) : shopGroups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
            <Package className="size-7 text-[#10B981]" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-slate-900">ไม่มีสินค้า</h3>
          <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
            {statusFilter === "pending_review" ? "ไม่มีสินค้ารอตรวจสอบในขณะนี้" : "ไม่พบสินค้าตามเงื่อนไขที่เลือก"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shopGroups.map((group) => (
            <Card key={group.shopId} className="gap-0 border-slate-200 py-0 shadow-none">
              <button
                type="button"
                onClick={() => toggleShop(group.shopId)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Store className="size-4 shrink-0 text-[#10B981]" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <span className="truncate">{group.shopName}</span>
                      <SellerVMark status={group.sellerVerificationStatus} size="sm" />
                    </p>
                    <p className="truncate text-xs text-slate-400">{group.sellerName} · {group.sellerEmail}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge className="rounded-full bg-amber-100 text-[10px] text-amber-700 ring-1 ring-inset ring-amber-600/15">
                    {group.products.length} สินค้า
                  </Badge>
                  {expandedShops.has(group.shopId) ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                </div>
              </button>

              {expandedShops.has(group.shopId) && (
                <CardContent className="border-t border-slate-100 px-3 pb-3 pt-3 sm:px-4">
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
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={product.status} />
                          <Clock className="hidden size-3.5 text-slate-300 sm:block" />
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

      {/* ── Product inspection workspace ────────────────────────────────────
          Full-screen sheet on phones, large two-pane dialog on desktop.
          Header and action bar stay pinned; only the body scrolls.

          Mobile is a purpose-built order, not a squeezed desktop: compact
          bounded gallery → identity (name / V / shop / status / price /
          category) → rejection reason → stock → then the long sections as
          disclosures. Desktop keeps the two-column workspace via explicit grid
          placement. No data is hidden on small screens — only re-flowed. */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:rounded-2xl sm:border"
        >
          <DialogHeader className="shrink-0 gap-1 space-y-0 border-b border-slate-100 px-4 py-3 text-left sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Package className="size-4 shrink-0 text-[#10B981]" />
                  <DialogTitle className="min-w-0 flex-1 truncate text-base">
                    {detailProduct?.product.name ?? "ตรวจสอบสินค้า"}
                  </DialogTitle>
                  {detailProduct && <StatusBadge status={detailProduct.product.status} />}
                </div>
                <DialogDescription className="mt-1 truncate text-xs">
                  {detailProduct
                    ? `${detailProduct.shop.name} · ${detailProduct.shop.seller_name}`
                    : "ตรวจสอบรายละเอียดสินค้าและดำเนินการตรวจสอบ"}
                </DialogDescription>
              </div>
              {/* Explicit, thumb-sized close control (the default one is 16px). */}
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                aria-label="ปิดหน้าตรวจสอบสินค้า"
                className="-mr-1 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-5" />
              </button>
            </div>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {detailLoading ? (
              <div className="flex items-center justify-center gap-2 px-6 py-20 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" /> กำลังโหลด...
              </div>
            ) : detailError ? (
              <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
                <AlertCircle className="size-6 text-rose-400" />
                <p className="text-sm text-rose-600">{detailError}</p>
                {detailProductId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-[10px]"
                    onClick={() => void loadDetail(detailProductId)}
                  >
                    ลองใหม่
                  </Button>
                )}
              </div>
            ) : !detailProduct ? (
              <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
                <AlertCircle className="size-6 text-rose-400" />
                <p className="text-sm text-rose-600">ไม่สามารถโหลดรายละเอียดได้</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-x-6 lg:gap-y-5 lg:py-6">
                <Section
                  title="รูปภาพสินค้า"
                  icon={<Layers className="size-3.5" />}
                  className="order-1 lg:order-none lg:col-start-1 lg:row-start-1"
                >
                  <ImageGallery images={detailProduct.images} primaryImage={detailProduct.primaryImage} />
                </Section>

                <Section
                  title="ข้อมูลสินค้า"
                  icon={<Package className="size-3.5" />}
                  className="order-2 lg:order-none lg:col-start-2 lg:row-start-1"
                >
                  <div className="space-y-2">
                    <ProductSummaryCard detail={detailProduct} />
                    <InfoRows
                      rows={[
                        { label: "รหัสสินค้า", value: <span className="font-mono text-xs">{detailProduct.product.id.slice(0, 8)}</span> },
                        { label: "สกุลเงิน", value: detailProduct.product.currency },
                        { label: "หมวดหมู่", value: detailProduct.product.category_name ?? detailProduct.product.category_id ?? "—" },
                        { label: "สร้างเมื่อ", value: new Date(detailProduct.product.created_at).toLocaleString() },
                        { label: "อัปเดตล่าสุด", value: new Date(detailProduct.product.updated_at).toLocaleString() },
                      ]}
                    />
                  </div>
                </Section>

                {detailProduct.product.rejection_reason && (
                  <div className="order-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 lg:order-none lg:col-start-1 lg:row-start-2">
                    <p className="text-xs font-medium text-rose-700">เหตุผลที่ปฏิเสธ:</p>
                    <p className="mt-1 break-words text-sm text-rose-600">{detailProduct.product.rejection_reason}</p>
                  </div>
                )}

                <Section
                  title="สต็อก"
                  icon={<Truck className="size-3.5" />}
                  className="order-4 lg:order-none lg:col-start-2 lg:row-start-2"
                >
                  <StockGrid inventory={detailProduct.inventory} />
                </Section>

                {detailProduct.product.description && (
                  <Section
                    title="รายละเอียดสินค้า"
                    collapsible
                    count={detailProduct.product.description.length}
                    className="order-5 lg:order-none lg:col-start-2 lg:row-start-3"
                  >
                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-600">
                      {detailProduct.product.description}
                    </div>
                  </Section>
                )}

                {detailProduct.optionGroups.length > 0 && (
                  <Section
                    title="ตัวเลือกสินค้า (Option groups)"
                    icon={<Tag className="size-3.5" />}
                    collapsible
                    count={detailProduct.optionGroups.length}
                    className="order-6 lg:order-none lg:col-start-2 lg:row-start-4"
                  >
                    <OptionGroupsList groups={detailProduct.optionGroups} />
                  </Section>
                )}

                {detailProduct.variants.length > 0 && (
                  <Section
                    title="ความหลากหลายสินค้า (Variants)"
                    icon={<Layers className="size-3.5" />}
                    collapsible
                    count={detailProduct.variants.length}
                    className="order-7 lg:order-none lg:col-start-2 lg:row-start-5"
                  >
                    <VariantList variants={detailProduct.variants} />
                  </Section>
                )}

                {detailProduct.attributes.length > 0 && (
                  <Section
                    title="คุณสมบัติ (Attributes)"
                    icon={<Tag className="size-3.5" />}
                    collapsible
                    count={detailProduct.attributes.length}
                    className="order-8 lg:order-none lg:col-start-2 lg:row-start-6"
                  >
                    <InfoRows rows={detailProduct.attributes.map((attr) => ({ label: attr.name, value: attr.value }))} />
                  </Section>
                )}

                <Section
                  title="ร้านค้า / ผู้ขาย"
                  icon={<Store className="size-3.5" />}
                  className="order-9 lg:order-none lg:col-start-1 lg:row-start-3"
                >
                  <ShopCard shop={detailProduct.shop} />
                </Section>

                {detailProduct.moderationHistory.length > 0 && (
                  <Section
                    title="ประวัติการตรวจสอบ"
                    icon={<History className="size-3.5" />}
                    collapsible
                    count={detailProduct.moderationHistory.length}
                    className="order-10 lg:order-none lg:col-start-1 lg:row-start-4"
                  >
                    <ModerationHistoryList history={detailProduct.moderationHistory} />
                  </Section>
                )}
              </div>
            )}
          </div>

          {/* Pinned action bar — approve/reject stay reachable on every screen */}
          <DialogFooter className="shrink-0 flex-col gap-2 border-t border-slate-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:py-3">
            {!isPending || !detailProduct ? (
              <Button variant="outline" className="w-full rounded-[10px] sm:w-auto" onClick={() => setDetailOpen(false)}>
                ปิด
              </Button>
            ) : moderationChoice === null ? (
              <>
                <Button variant="ghost" className="w-full rounded-[10px] sm:w-auto" onClick={() => setDetailOpen(false)} disabled={acting}>
                  ปิด
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-1.5 rounded-[10px] border-rose-200 text-rose-600 hover:bg-rose-50 sm:w-auto"
                  onClick={() => setModerationChoice("reject")}
                  disabled={acting}
                >
                  <X className="size-4" /> ปฏิเสธ
                </Button>
                <Button
                  className="w-full gap-1.5 rounded-[10px] bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
                  onClick={() => setModerationChoice("approve")}
                  disabled={acting}
                >
                  <CheckCircle2 className="size-4" /> อนุมัติ
                </Button>
              </>
            ) : moderationChoice === "approve" ? (
              <>
                <p className="flex-1 text-xs text-slate-500 sm:text-left">ยืนยันการอนุมัติสินค้านี้?</p>
                <Button variant="outline" className="rounded-[10px]" onClick={() => setModerationChoice(null)} disabled={acting}>
                  ยกเลิก
                </Button>
                <Button
                  className="gap-1.5 rounded-[10px] bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void handleModeration()}
                  disabled={acting}
                >
                  {acting && <Loader2 className="size-3.5 animate-spin" />} ยืนยันอนุมัติ
                </Button>
              </>
            ) : (
              <div className="w-full space-y-2">
                <Label className="text-xs font-medium text-slate-500">เหตุผลที่ปฏิเสธ *</Label>
                <Textarea
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="กรุณาระบุเหตุผลที่ปฏิเสธสินค้า..."
                  className="rounded-[10px] border-slate-200 bg-white text-sm"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    className="rounded-[10px]"
                    onClick={() => { setModerationChoice(null); setRejectReason(""); }}
                    disabled={acting}
                  >
                    ยกเลิก
                  </Button>
                  <Button
                    className="gap-1.5 rounded-[10px] bg-rose-600 text-white hover:bg-rose-700"
                    onClick={() => void handleModeration()}
                    disabled={acting || !rejectReason.trim()}
                  >
                    {acting && <Loader2 className="size-3.5 animate-spin" />} ยืนยันปฏิเสธ
                  </Button>
                </div>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
