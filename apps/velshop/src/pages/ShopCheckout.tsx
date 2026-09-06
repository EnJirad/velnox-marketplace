import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { VelRepeatPlanDialog } from "@/components/shop/VelRepeatPlanDialog";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@velnox/shared/components/ui/sheet";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { useTracking } from "@velnox/shared/lib/track";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Globe,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface AddressRow {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: number;
}

interface CheckoutItemSummary {
  productId: string;
  variantId: string | null;
  name: string;
  qty: number;
  unit: string;
  price: number;
  imageUrl: string | null;
  vrepeatEnabled: boolean;
}

interface CheckoutResult {
  parentOrderId: string;
  parentOrderNumber: string;
  orders: Array<{ orderId: string; orderNumber: string; shopId: string; shopName: string; subtotal: number; shippingFee: number; total: number }>;
  total: number;
  itemCount: number;
  priceChanged?: boolean;
  items?: CheckoutItemSummary[];
}

const PAYMENT_METHODS: Array<{ id: string; icon: LucideIcon }> = [
  { id: "cod", icon: Banknote },
  { id: "online", icon: Globe },
];

/* ── Helpers ───────────────────────────────────────────────────────────── */

function formatAddress(a: AddressRow): string {
  const parts = [a.line1, a.line2, a.subdistrict, a.district, a.province, a.postalCode].filter(Boolean);
  return parts.join(" · ");
}

function payKey(id: string): string {
  const map: Record<string, string> = { cod: "Cod", promptpay: "Promptpay", transfer: "Transfer", card: "Card", online: "Online" };
  return `checkout.pay${map[id] ?? "Cod"}`;
}

/** Address picker card used in the desktop layout and address bottom sheet. */
function AddressPickerCard({ a, active, onClick, t }: {
  a: AddressRow;
  active: boolean;
  onClick: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const gps = a.latitude != null && a.longitude != null;
  return (
    <button type="button" onClick={onClick}
      className={`w-full overflow-hidden rounded-xl border-2 p-4 text-left transition-colors ${active ? "border-[#10B981] bg-[#F0FDF9]" : "border-slate-200 bg-white hover:border-slate-300"}`}
      aria-pressed={active}
    >
      <div className="flex items-center justify-between gap-2 overflow-hidden">
        <p className="flex min-w-0 items-center gap-2 overflow-hidden text-sm font-semibold text-slate-900">
          {a.label}
          {a.isDefault && <Badge className="rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">{t("checkout.defaultBadge")}</Badge>}
          {!gps && <Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-50">{t("checkout.noGpsBadge")}</Badge>}
        </p>
        <span className={`size-4 shrink-0 rounded-full border-2 ${active ? "border-[#10B981] bg-[#10B981]" : "border-slate-300 bg-white"}`} />
      </div>
      <p className="mt-1 min-w-0 truncate text-sm leading-5 text-slate-600" title={formatAddress(a)} style={{ overflowWrap: "anywhere" }}>{formatAddress(a)}</p>
      <p className="mt-0.5 min-w-0 truncate text-xs text-slate-400" title={`${a.recipientName} · ${a.phone}`} style={{ overflowWrap: "anywhere" }}>{a.recipientName} · {a.phone}</p>
    </button>
  );
}

/* ── Main Component ────────────────────────────────────────────────────── */

export default function ShopCheckout() {
  const { t } = useLanguage();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { lines, total, count, clear, reload, syncing } = useCart();
  const location = useLocation();
  const navState = (location.state ?? {}) as {
    selectedCartItems?: string[];
    buyNow?: boolean;
    buyNowProductId?: string;
    buyNowVariantId?: string | null;
    buyNowQty?: number;
  };
  const myAddresses = useAction(api.customer.myAddresses);
  const checkoutAction = useAction(api.customer.checkoutAction);
  const createStripeCheckout = useAction(api.stripe.createStripeCheckoutAction);
  const stripeConfigured = useAction(api.stripe.stripeConfiguredAction);
  const { track } = useTracking();

  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [addressError, setAddressError] = useState(false);
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [stripeReady, setStripeReady] = useState<boolean | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [vrOpen, setVrOpen] = useState(false);
  const [productsExpanded, setProductsExpanded] = useState(false);

  const requestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
  }, []);

  useEffect(() => {
    let cancelled = false;
    stripeConfigured().then((ok) => !cancelled && setStripeReady(Boolean(ok))).catch(() => !cancelled && setStripeReady(false));
    return () => { cancelled = true; };
  }, [stripeConfigured]);

  const loadAddresses = useCallback(async () => {
    try {
      const rows = (await myAddresses()) as unknown as AddressRow[];
      setAddresses(rows);
      setAddressError(false);
      const def = rows.find((a) => a.isDefault) ?? rows[0];
      setSelectedAddressId((prev) => prev ?? def?.id ?? null);
    } catch (err) {
      console.error("Load addresses error:", err);
      setAddresses([]);
      setAddressError(true);
    }
  }, [myAddresses]);

  useEffect(() => {
    if (isAuthenticated && addresses === null) void loadAddresses();
  }, [isAuthenticated, addresses, loadAddresses]);

  const selectedAddress = useMemo(() => addresses?.find((a) => a.id === selectedAddressId) ?? null, [addresses, selectedAddressId]);
  const hasGps = selectedAddress?.latitude != null && selectedAddress.longitude != null;

  const checkoutLines = useMemo(() => {
    if (navState.buyNow && navState.buyNowProductId) {
      return lines.filter((l) => {
        if (l.productId !== navState.buyNowProductId) return false;
        if (navState.buyNowVariantId != null) return l.variantId === navState.buyNowVariantId;
        return l.variantId == null;
      });
    }
    if (navState.selectedCartItems && navState.selectedCartItems.length > 0) {
      return lines.filter((l) => navState.selectedCartItems!.includes(l.id));
    }
    return lines;
  }, [lines, navState]);

  const checkoutTotal = useMemo(() => checkoutLines.reduce((s, l) => s + l.qty * l.price, 0), [checkoutLines]);
  const checkoutCount = useMemo(() => checkoutLines.reduce((s, l) => s + l.qty, 0), [checkoutLines]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof checkoutLines>();
    for (const line of checkoutLines) {
      const key = line.shopName ?? t("wishlist.defaultShop");
      const list = map.get(key) ?? [];
      list.push(line);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [checkoutLines, t]);

  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current || checkoutCount === 0) return;
    checkoutTracked.current = true;
    track("CHECKOUT_START", { value: `${t("checkout.itemsCount", { count: checkoutCount })}`, context: { itemCount: checkoutCount, total: checkoutTotal } });
  }, [checkoutCount]);

  const handleSubmit = async () => {
    if (!selectedAddressId) { toast.error(t("checkout.selectAddress")); return; }
    if (!hasGps) { toast.error(t("checkout.gpsRequired")); return; }
    setSubmitting(true);
    try {
      const checkoutPayload: Record<string, unknown> = {
        addressId: selectedAddressId,
        paymentMethod,
        shippingMethod: "standard",
        requestId: requestIdRef.current ?? crypto.randomUUID(),
      };
      if (navState.selectedCartItems && navState.selectedCartItems.length > 0) {
        checkoutPayload.cartItemIds = navState.selectedCartItems;
      } else if (navState.buyNow) {
        checkoutPayload.cartItemIds = checkoutLines.map((l) => l.id);
      }
      const res = (await checkoutAction(checkoutPayload)) as unknown as CheckoutResult;
      setResult(res);
      const isSelectiveCheckout = (navState.selectedCartItems && navState.selectedCartItems.length > 0) || navState.buyNow;
      if (isSelectiveCheckout) { reload(); } else { clear(); }
      if (res.priceChanged) { toast.warning(t("checkout.priceChanged")); } else { toast.success(t("checkout.success")); }
    } catch (err) {
      console.error("Checkout error:", err);
      toast.error(err instanceof Error ? err.message : t("checkout.failed"));
      reload();
    } finally { setSubmitting(false); }
  };

  const handlePayOnline = async () => {
    if (!result) return;
    setPaying(true);
    try {
      const { url } = (await createStripeCheckout({ orderId: result.parentOrderId, returnPath: `/orders?order=${result.parentOrderId}` })) as unknown as { url: string };
      if (!url) throw new Error(t("checkout.payNowDesc"));
      window.location.assign(url);
    } catch (err) {
      console.error("Stripe checkout error:", err);
      toast.error(err instanceof Error ? err.message : t("checkout.failed"));
      setPaying(false);
    }
  };

  const eligibleItem = useMemo(() => result?.items?.find((i) => i.vrepeatEnabled) ?? null, [result]);
  const offerProduct = useMemo<StoreProduct | null>(() => {
    if (!eligibleItem) return null;
    return { id: eligibleItem.productId, name: eligibleItem.name, price: eligibleItem.price, unit: eligibleItem.unit || "" } as unknown as StoreProduct;
  }, [eligibleItem]);

  // ── Products for mobile compact list ────────────────────────────────────
  const MOBILE_PRODUCT_LIMIT = 3;
  const visibleMobileLines = productsExpanded ? checkoutLines : checkoutLines.slice(0, MOBILE_PRODUCT_LIMIT);
  const hiddenMobileCount = checkoutLines.length - MOBILE_PRODUCT_LIMIT;

  // ═══════════════════════════════════════════════════════════════════════
  // Success screen
  // ═══════════════════════════════════════════════════════════════════════
  if (result) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto w-full max-w-2xl px-4 py-14 sm:px-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-[#ECFDF5]">
              <CheckCircle2 className="size-8 text-[#10B981]" />
            </span>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">{t("checkout.successTitle")}</h1>
            <p className="mt-2 text-sm text-slate-500">{t("checkout.successDesc")}</p>
          </div>
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">{t("checkout.orderNo")}</p>
              <p className="font-mono text-sm font-semibold text-slate-900">{result.parentOrderNumber}</p>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm text-slate-500">{t("checkout.totalItems", { count: result.itemCount })}</p>
              <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(result.total)}</p>
            </div>
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-5">
              {result.orders.map((o) => (
                <div key={o.orderId} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
                    <Store className="size-3.5 shrink-0 text-[#10B981]" />
                    <span className="min-w-0 truncate">{o.shopName || t("checkout.shopPending")}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-50">{t("checkoutSuccess.pending")}</Badge>
                    <span className="font-medium tabular-nums text-slate-900">{formatBaht(o.total)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          {eligibleItem && offerProduct && (
            <div className="mt-6 rounded-2xl border border-[#10B981]/25 bg-[#F0FDF9] p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#10B981] ring-1 ring-[#10B981]/15"><RefreshCw className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{t("checkout.repeatOfferTitle")}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{t("checkout.repeatOfferDesc")}</p>
                  <Button className="mt-3 gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600" size="sm" onClick={() => setVrOpen(true)}>
                    <RefreshCw className="size-3.5" />{t("velrepeatPlan.start")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <VelRepeatPlanDialog product={offerProduct} open={vrOpen} onOpenChange={setVrOpen}
            selectedVariant={eligibleItem?.variantId ? { id: eligibleItem.variantId, name: "", price: eligibleItem.price } : null} />
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {paymentMethod === "online" ? (
              <Button className="flex-1 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={handlePayOnline} disabled={paying}>
                {paying ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                {t("checkout.payNow")}
              </Button>
            ) : (
              <Button className="flex-1 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild><Link to="/orders">{t("checkout.trackOrder")}</Link></Button>
            )}
            <Button variant="outline" className="flex-1 border-slate-200 text-slate-700" asChild><Link to="/orders">{t("checkout.viewOrders")}</Link></Button>
            <Button variant="outline" className="flex-1 border-slate-200 text-slate-700" asChild><Link to="/">{t("checkout.continueShopping")}</Link></Button>
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">
            {paymentMethod === "online" ? t("checkout.payNowDesc") : t("checkout.paymentNote", { method: t(payKey(paymentMethod)) })}
          </p>
        </main>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Empty cart
  // ═══════════════════════════════════════════════════════════════════════
  if (!syncing && !authLoading && isAuthenticated && checkoutCount === 0) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100"><ShoppingBag className="size-7 text-slate-400" /></span>
          <h1 className="mt-5 text-xl font-bold text-slate-900">{t("checkout.emptyTitle")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("checkout.emptyDesc")}</p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild><Link to="/"><ArrowLeft className="size-4" />{t("checkout.backToShop")}</Link></Button>
        </main>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Main checkout
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen max-w-full bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-6xl px-4 pb-36 pt-4 sm:px-6 sm:pt-10 lg:pb-10 lg:pt-10">
        {/* Back + Title */}
        <div className="flex min-w-0 items-center gap-2 lg:gap-3">
          <Button variant="ghost" size="icon" className="size-8 shrink-0 text-slate-500 lg:size-9" asChild>
            <Link to="/cart" aria-label={t("checkout.backToCart")}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl" style={{ overflowWrap: "anywhere" }}>{t("checkout.title")}</h1>
            <p className="mt-0.5 hidden min-w-0 truncate text-sm text-slate-500 sm:block" style={{ overflowWrap: "anywhere" }}>{t("checkout.desc")}</p>
          </div>
        </div>

        {/* ═══════════ MOBILE: compact flat layout ═══════════ */}
        <div className="mt-4 lg:hidden">
          {/* ── Address row ── */}
          <section className="bg-white">
            {addresses === null && !addressError ? (
              <div className="px-4 py-3"><Skeleton className="h-14 rounded-xl" /></div>
            ) : addressError ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <AlertCircle className="size-4 shrink-0 text-rose-400" />
                <p className="min-w-0 flex-1 text-xs text-slate-600">{t("checkout.addressLoadFailed")}</p>
                <button type="button" className="shrink-0 text-xs font-medium text-[#10B981]" onClick={() => { setAddressError(false); setAddresses(null); void loadAddresses(); }}>{t("common.retry")}</button>
              </div>
            ) : (addresses ?? []).length === 0 ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <MapPin className="size-4 shrink-0 text-slate-300" />
                <p className="min-w-0 flex-1 text-xs text-slate-500">{t("checkout.noAddress")}</p>
                <Link to="/addresses" className="shrink-0 text-xs font-medium text-[#10B981]">{t("checkout.addAddress")}</Link>
              </div>
            ) : (
              <button type="button" onClick={() => setAddressSheetOpen(true)} className="w-full px-4 py-3 text-left" aria-haspopup="dialog">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <MapPin className="size-3.5 shrink-0 text-[#10B981]" />
                    {t("checkout.compactAddress")}
                    {selectedAddress?.isDefault && <Badge className="ml-1 rounded-full bg-slate-100 px-1.5 py-0 text-[10px] text-slate-500">{t("checkout.defaultBadge")}</Badge>}
                  </p>
                  <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-[#10B981]">
                    {t("checkout.changeAddress")}<ChevronDown className="size-3" />
                  </span>
                </div>
                {selectedAddress && (
                  <p className="mt-1 min-w-0 truncate text-sm text-slate-900" style={{ overflowWrap: "anywhere" }}>
                    {selectedAddress.recipientName} · {selectedAddress.phone}
                  </p>
                )}
                {selectedAddress && (
                  <p className="mt-0.5 min-w-0 truncate text-xs text-slate-400" style={{ overflowWrap: "anywhere" }}>
                    {formatAddress(selectedAddress)}
                  </p>
                )}
              </button>
            )}

            {!hasGps && selectedAddress && (
              <p className="mx-4 mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <MapPin className="size-3 shrink-0" />{t("checkout.gpsWarning")}
              </p>
            )}

            {/* GPS warning with bottom margin if no address selected and no warning */}
            {(!selectedAddress || hasGps) && <div className="h-0" />}

            <Sheet open={addressSheetOpen} onOpenChange={setAddressSheetOpen}>
              <SheetContent side="bottom" className="max-h-[75vh] rounded-t-2xl border-slate-200 p-0 pb-[env(safe-area-inset-bottom)]">
                <SheetHeader className="border-b border-slate-100 px-5 py-4 text-left">
                  <SheetTitle className="text-base font-bold tracking-tight text-slate-900">{t("checkout.addressSheetTitle")}</SheetTitle>
                </SheetHeader>
                <div className="grid gap-2.5 overflow-y-auto px-5 py-4">
                  {(addresses ?? []).map((a) => (
                    <AddressPickerCard key={a.id} a={a} active={a.id === selectedAddressId} t={t} onClick={() => { setSelectedAddressId(a.id); setAddressSheetOpen(false); }} />
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </section>

          {/* ── Products list (compact, collapsible) ── */}
          <section className="border-t border-slate-100 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">{t("checkout.itemsCount", { count: checkoutCount })}</p>
            <div className="mt-2 space-y-2.5">
              {visibleMobileLines.map((line) => (
                <div key={line.id} className="flex min-w-0 items-center gap-3">
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt={line.name} className="size-14 shrink-0 rounded-lg border border-slate-100 object-cover" loading="lazy" />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-slate-50"><ShoppingBag className="size-4 text-slate-300" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="min-w-0 truncate text-sm font-medium text-slate-900" title={line.name} style={{ overflowWrap: "anywhere" }}>{line.name}</p>
                    {line.variantOptionLabels && <p className="min-w-0 truncate text-xs text-[#10B981]">{line.variantOptionLabels}</p>}
                    <p className="text-xs text-slate-400">× {line.qty}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">{formatBaht(line.qty * line.price)}</span>
                </div>
              ))}
            </div>
            {!productsExpanded && hiddenMobileCount > 0 && (
              <button type="button" onClick={() => setProductsExpanded(true)}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-slate-50 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100">
                {t("checkout.showMoreItems", { count: hiddenMobileCount })}
              </button>
            )}
          </section>

          {/* ── Payment (radio list) ── */}
          <section className="border-t border-slate-100 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">{t("checkout.paymentTitle")}</p>
            <div className="mt-2">
              {PAYMENT_METHODS.filter((m) => m.id !== "online" || stripeReady !== false).map((m) => {
                const active = paymentMethod === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => setPaymentMethod(m.id)}
                    className={`flex w-full items-center gap-3 py-2.5 text-left transition-colors ${active ? "text-slate-900" : "text-slate-500"}`}
                    aria-checked={active} role="radio"
                  >
                    <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${active ? "border-[#10B981]" : "border-slate-300"}`}>
                      {active && <span className="size-2 rounded-full bg-[#10B981]" />}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="text-sm font-medium">{t(payKey(m.id))}</span>
                      <span className="min-w-0 truncate text-xs text-slate-400">{t(`${payKey(m.id)}Desc`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Summary ── */}
          <section className="border-t border-slate-100 bg-white px-4 py-3">
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("checkout.shipping")}</span>
                <span className="text-slate-400">{t("checkout.shippingFree")}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="font-medium text-slate-900">{t("checkout.total")}</span>
                <span className="text-lg font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(checkoutTotal)}</span>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] leading-5 text-slate-400">{t("checkout.priceNote")}</p>
          </section>
        </div>

        {/* ═══════════ DESKTOP: card-based layout (unchanged) ═══════════ */}
        <div className="mt-8 hidden min-w-0 gap-6 lg:grid lg:grid-cols-5">
          <div className="min-w-0 space-y-6 lg:col-span-3">
            {/* Address card */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight text-slate-900">
                  <MapPin className="size-4 shrink-0 text-[#10B981]" />
                  <span className="min-w-0 truncate" style={{ overflowWrap: "anywhere" }}>{t("checkout.addressTitle")}</span>
                </h2>
                <Button variant="ghost" size="sm" className="gap-1 text-xs text-[#10B981] hover:bg-[#ECFDF5]" asChild>
                  <Link to="/addresses">{t("checkout.manage")}</Link>
                </Button>
              </div>
              {addresses === null && !addressError ? (
                <div className="mt-4 space-y-3"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
              ) : addressError ? (
                <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-rose-200 bg-rose-50 px-6 py-10 text-center">
                  <AlertCircle className="size-6 text-rose-400" />
                  <p className="mt-3 text-sm font-medium text-slate-700">{t("checkout.addressLoadFailed")}</p>
                  <Button variant="outline" size="sm" className="mt-4 border-slate-200 text-slate-700" onClick={() => { setAddressError(false); setAddresses(null); void loadAddresses(); }}>{t("common.retry")}</Button>
                </div>
              ) : (addresses ?? []).length === 0 ? (
                <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
                  <MapPin className="size-6 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-600">{t("checkout.noAddress")}</p>
                  <p className="mt-1 text-xs text-slate-400">{t("checkout.noAddressDesc")}</p>
                  <Button variant="outline" size="sm" className="mt-4 border-slate-200 text-slate-700" asChild><Link to="/addresses">{t("checkout.addAddress")}</Link></Button>
                </div>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {(addresses ?? []).map((a) => (
                    <AddressPickerCard key={a.id} a={a} active={a.id === selectedAddressId} t={t} onClick={() => setSelectedAddressId(a.id)} />
                  ))}
                </div>
              )}
              {!hasGps && selectedAddress && (
                <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><MapPin className="size-3.5 shrink-0" />{t("checkout.gpsWarning")}</p>
              )}
            </section>

            {/* Payment card */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight text-slate-900">
                <CreditCard className="size-4 shrink-0 text-[#10B981]" />
                <span className="min-w-0 truncate" style={{ overflowWrap: "anywhere" }}>{t("checkout.paymentTitle")}</span>
              </h2>
              <div className="mt-4 grid min-w-0 gap-2.5 sm:grid-cols-2">
                {PAYMENT_METHODS.filter((m) => m.id !== "online" || stripeReady !== false).map((m) => {
                  const Icon = m.icon;
                  const active = paymentMethod === m.id;
                  return (
                    <button key={m.id} type="button" onClick={() => setPaymentMethod(m.id)}
                      className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors ${active ? "border-[#10B981] bg-[#F0FDF9]" : "border-slate-200 bg-white hover:border-slate-300"}`}
                      aria-pressed={active}
                    >
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${active ? "bg-[#10B981] text-white" : "bg-slate-100 text-slate-500"}`}>
                        <Icon className="size-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">{t(payKey(m.id))}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{t(`${payKey(m.id)}Desc`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 min-w-0 truncate text-xs text-slate-400" title={user?.email ? t("checkout.confirmAccount", { email: user.email }) : undefined} style={{ overflowWrap: "anywhere" }}>
                {user?.email ? t("checkout.confirmAccount", { email: user.email }) : t("checkout.confirmAccount", { email: "" })}
              </p>
            </section>
          </div>

          {/* Desktop summary */}
          <div className="min-w-0 lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 lg:sticky lg:top-20">
              <h2 className="text-base font-bold tracking-tight text-slate-900">{t("checkout.summaryTitle")}</h2>
              <div className="mt-4 space-y-4">
                {grouped.map(([shopName, shopLines]) => (
                  <div key={shopName}>
                    <p className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-slate-500">
                      <Store className="size-3.5 shrink-0 text-[#10B981]" />
                      <span className="min-w-0 truncate">{shopName}</span>
                    </p>
                    <div className="mt-2 space-y-3">
                      {shopLines.map((line) => (
                        <div key={line.id} className="flex min-w-0 items-center gap-3 text-sm">
                          {line.imageUrl ? (
                            <img src={line.imageUrl} alt={line.name} className="size-12 shrink-0 rounded-[10px] border border-slate-100 object-cover" loading="lazy" />
                          ) : (
                            <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-slate-50"><ShoppingBag className="size-4 text-slate-300" /></span>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block min-w-0 truncate font-medium text-slate-700" title={line.name} style={{ overflowWrap: "anywhere" }}>{line.name}</span>
                            {line.variantOptionLabels && <span className="block min-w-0 truncate text-xs text-[#10B981]">{line.variantOptionLabels}</span>}
                            <span className="block min-w-0 truncate text-xs text-slate-400">{formatBaht(line.price)} / {line.unit} × {line.qty}</span>
                          </div>
                          <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatBaht(line.qty * line.price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-slate-500">{t("checkout.itemsCount", { count: checkoutCount })}</span>
                  <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatBaht(checkoutTotal)}</span>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-slate-500">{t("checkout.shipping")}</span>
                  <span className="shrink-0 text-slate-400">{t("checkout.shippingFree")}</span>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-500">{t("checkout.total")}</span>
                  <span className="shrink-0 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(checkoutTotal)}</span>
                </div>
              </div>
              <Button className="mt-5 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={handleSubmit} disabled={submitting || checkoutCount === 0 || addresses === null} aria-busy={submitting}>
                {submitting ? (<><Loader2 className="size-4 animate-spin" />{t("checkout.submitting")}</>) : (<><ShieldCheck className="size-4" />{t("checkout.submit", { total: formatBaht(checkoutTotal) })}</>)}
              </Button>
              <p className="mt-3 text-center text-[11px] leading-5 text-slate-400">{t("checkout.priceNote")}</p>
            </div>
          </div>
        </div>
      </main>

      {/* ═══════════ Mobile fixed bottom CTA ═══════════ */}
      {checkoutCount > 0 && !syncing && !authLoading && (
        <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 px-3 lg:hidden">
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-2.5 shadow-[0_10px_34px_rgba(15,23,42,0.16)] backdrop-blur sm:p-3">
            <div className="min-w-0 shrink-0">
              <p className="text-[11px] text-slate-400">{t("checkout.total")}</p>
              <p className="text-lg font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(checkoutTotal)}</p>
            </div>
            <Button className="h-11 flex-1 gap-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800" style={{ minWidth: 0, flexShrink: 1 }} onClick={handleSubmit} disabled={submitting || checkoutCount === 0 || addresses === null} aria-busy={submitting}>
              {submitting ? (<><Loader2 className="size-4 shrink-0 animate-spin" /><span className="min-w-0 truncate">{t("checkout.submitting")}</span></>) : (<><ShieldCheck className="size-4 shrink-0" /><span className="min-w-0 truncate">{t("checkout.submit", { total: formatBaht(checkoutTotal) })}</span></>)}
            </Button>
          </div>
        </div>
      )}

      <ShopFooter />
    </div>
  );
}
