/**
 * My Shop — the seller's own storefront: identity, verification and products.
 *
 * Part 1 restructure. The page is now a composition:
 *   • `ShopOnboarding`        — the "no shop yet" path (was inline Thai copy)
 *   • `ShopIdentityCard`      — storefront identity + the only shop editor
 *   • `ShopVerificationDialog`— two-step evidence wizard (was inline Thai copy)
 *   • this file               — data loading, product list, moderation actions
 *
 * Every string comes from `sellerDash.shop.*`. Nothing here invents a backend
 * field: products come from `GET /api/seller/products`, the shop from
 * `GET /api/seller/profile`, and the seller is always resolved server-side.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  BadgePercent,
  Clock,
  Eye,
  EyeOff,
  ImageOff,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@velnox/shared/components/AppHeader";
import { ProductFormDialog } from "@velnox/shared/components/seller/ProductFormDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@velnox/shared/components/ui/alert-dialog";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { ApiError, api, useAction } from "@velnox/shared/lib/api-routes";
import {
  PRODUCT_CATEGORY_META,
  formatBaht,
  type SellerProfile,
  type StoreProduct,
  type StoreProductStatus,
  type VerificationStatus,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { SITE_URLS } from "@velnox/shared/lib/sites";

import { ShopIdentityCard } from "../components/shop/ShopIdentityCard";
import { ShopOnboarding } from "../components/shop/ShopOnboarding";
import { ShopVerificationDialog } from "../components/shop/ShopVerificationDialog";

type StatusFilter = "all" | StoreProductStatus;

/** Terminal product states are VelCenter's decision — a seller cannot move them. */
const TERMINAL_STATUSES: StoreProductStatus[] = ["rejected", "suspended"];

export default function MyShop() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const mySellerProfile = useAction(api.commerce.mySellerProfile);
  const mySellerStatus = useAction(api.commerce.mySellerStatus);
  const listProducts = useAction(api.commerce.listProducts);
  const setStatus = useAction(api.commerce.setProductStatusAction);
  const deleteProduct = useAction(api.commerce.deleteProductAction);

  /** `undefined` = still loading, `null` = the request failed, object = loaded. */
  const [profile, setProfile] = useState<SellerProfile | null | undefined>(undefined);
  /**
   * `GET /api/seller/profile` is guarded by `requireApprovedSeller`, so every
   * applicant who is not yet approved gets 403. The page must not read that as
   * "broken": it asks `GET /api/seller/status` (reachable for pending cases) and
   * renders the real application state instead.
   */
  const [application, setApplication] = useState<{ status: string; reason: string | null } | null>(null);
  const [profileState, setProfileState] = useState<"loading" | "ok" | "denied" | "failed">("loading");
  const [products, setProducts] = useState<StoreProduct[] | undefined>(undefined);
  const [productsFailed, setProductsFailed] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [deleting, setDeleting] = useState<StoreProduct | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<{ kind: "seller" } | null>(null);
  const [verifyAtEvidence, setVerifyAtEvidence] = useState(false);

  const loadProfile = useCallback(async () => {
    setProfileState("loading");
    try {
      const data = await mySellerProfile();
      setProfile(data ?? null);
      setProfileState("ok");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        // Not approved yet — that is an application state, not a failure.
        try {
          const status = await mySellerStatus();
          setApplication(
            status?.status
              ? {
                  status: String(status.status),
                  reason: status.rejectionReason ?? status.correctionReason ?? null,
                }
              : null,
          );
          setProfile(null);
          setProfileState("denied");
        } catch (statusError) {
          console.error("Seller status error:", statusError);
          setProfileState("failed");
        }
        return;
      }
      console.error("Seller profile error:", error);
      setProfileState("failed");
    }
  }, [mySellerProfile, mySellerStatus]);

  const loadProducts = useCallback(async () => {
    setProductsFailed(false);
    try {
      const rows = await listProducts({ mine: true });
      setProducts(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error("Seller products error:", error);
      setProductsFailed(true);
      setProducts([]);
    }
  }, [listProducts]);

  useEffect(() => {
    void loadProfile();
    void loadProducts();
  }, [loadProfile, loadProducts]);

  // A VelCenter correction request reaches the seller as
  // `/seller/shop?verification=<id>&correction=1`. The identifier only selects
  // the flow — ownership is enforced by the backend when the wizard loads and
  // submits its evidence. Strip it so a refresh does not reopen the dialog.
  useEffect(() => {
    const verificationId = searchParams.get("verification");
    if (!verificationId) return;
    setVerifyAtEvidence(true);
    setVerifyTarget({ kind: "seller" });
    const next = new URLSearchParams(searchParams);
    next.delete("verification");
    next.delete("correction");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const shop = profile?.shops?.[0] ?? null;
  const verificationStatus = ((profile?.seller as { verificationStatus?: VerificationStatus } | undefined)
    ?.verificationStatus ?? "unverified") as VerificationStatus;

  const counts = useMemo(() => {
    const rows = products ?? [];
    return {
      all: rows.length,
      published: rows.filter((p) => p.status === "published").length,
      pending: rows.filter((p) => p.status === "pending_review").length,
      rejected: rows.filter((p) => p.status === "rejected").length,
    };
  }, [products]);

  const statusFilters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: "all", label: t("sellerDash.shop.statAll"), count: counts.all },
    { key: "published", label: t("sellerDash.shop.statPublished"), count: counts.published },
    { key: "pending_review", label: t("sellerDash.shop.statPending"), count: counts.pending },
    { key: "draft", label: t("productModeration.statusDraft"), count: (products ?? []).filter((p) => p.status === "draft").length },
    { key: "rejected", label: t("sellerDash.shop.statRejected"), count: counts.rejected },
  ];

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (products ?? []).filter((product) => {
      if (statusFilter !== "all" && product.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        (product.categorySlug ?? "").toLowerCase().includes(needle)
      );
    });
  }, [products, query, statusFilter]);

  const handleTogglePublish = async (product: StoreProduct) => {
    setTogglingId(product.id);
    try {
      if (product.status === "published") {
        const updated = await setStatus({ productId: product.id, status: "draft" });
        toast.success(t("productModeration.unpublishedToast"));
        if (updated) setProducts((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)));
        return;
      }
      // A seller can only ever ask for `pending_review`; approval is VelCenter's.
      const updated = await setStatus({ productId: product.id, status: "pending_review" });
      toast.success(
        updated?.status === "published"
          ? t("sellerDash.shop.toastPublished")
          : t("productModeration.submittedToast"),
      );
      if (updated) setProducts((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)));
    } catch (error) {
      console.error("Toggle publish error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await deleteProduct({ productId: deleting.id });
      toast.success(t("sellerDash.shop.toastDeleted"));
      setProducts((prev) => prev?.filter((p) => p.id !== deleting.id));
      setDeleting(null);
    } catch (error) {
      console.error("Delete error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setDeletingBusy(false);
    }
  };

  const renderStatus = (product: StoreProduct) => {
    if (product.status === "published") {
      return (
        <Badge className="gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-emerald-50">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          {t("productModeration.statusPublished")}
        </Badge>
      );
    }
    if (product.status === "pending_review") {
      return (
        <Badge className="gap-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-50">
          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          {t("productModeration.statusPendingReview")}
        </Badge>
      );
    }
    if (product.status === "rejected") {
      return (
        <Badge className="gap-1 rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15 hover:bg-rose-50">
          <XCircle className="size-3" aria-hidden="true" />
          {t("productModeration.statusRejected")}
        </Badge>
      );
    }
    if (product.status === "suspended") {
      return (
        <Badge className="gap-1 rounded-full bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/15 hover:bg-orange-50">
          <XCircle className="size-3" aria-hidden="true" />
          {t("productModeration.statusSuspended")}
        </Badge>
      );
    }
    return (
      <Badge className="gap-1 rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
        <span className="size-1.5 rounded-full bg-slate-400" aria-hidden="true" />
        {t("productModeration.statusDraft")}
      </Badge>
    );
  };

  const toggleLabel = (product: StoreProduct) => {
    if (product.status === "published") return t("sellerDash.shop.toggleUnpublish");
    if (product.status === "pending_review") return t("sellerDash.shop.togglePending");
    return t("sellerDash.shop.togglePublish");
  };

  const availableOf = (product: StoreProduct) =>
    product.inventory?.available ?? product.inventory?.quantity ?? 0;

  /**
   * Non-approved sellers see their real application state — never a fake shop.
   * `status` comes from `sellers.status` (profile or status endpoint), never
   * from the client.
   */
  const renderGate = (status: string, reason: string | null) => {
    const pending = status === "pending" || status === "under_review";
    const rejected = status === "rejected" || status === "needs_correction";
    const suspended = status === "suspended";
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
            <span
              className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${
                pending ? "bg-amber-50" : "bg-rose-50"
              }`}
            >
              {pending ? (
                <Clock className="size-7 text-amber-500" aria-hidden="true" />
              ) : (
                <XCircle className="size-7 text-rose-500" aria-hidden="true" />
              )}
            </span>
            <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
              {suspended
                ? t("gate.sellerSuspendedTitle")
                : pending
                  ? t("gate.sellerPendingTitle")
                  : t("gate.sellerRejectedTitle")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {suspended
                ? t("gate.sellerSuspendedDesc")
                : pending
                  ? t("gate.sellerPendingDesc")
                  : t("gate.sellerRejectedDesc")}
            </p>
            {reason && (rejected || suspended) && (
              <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
                {t("gate.sellerRejectedReason", { reason })}
              </p>
            )}
            <Button variant="ghost" className="mt-6 w-full text-slate-500" asChild>
              <a href={SITE_URLS.velshop}>{t("gate.sellerBackToShop")}</a>
            </Button>
          </div>
        </main>
      </div>
    );
  };


  // ------------------------------------------------------------- states
  if (profileState === "loading") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10" aria-busy="true">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-100 sm:h-32" />
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-100" />
          <p className="sr-only">{t("sellerDash.shop.productsLoading")}</p>
        </main>
      </div>
    );
  }

  if (profileState === "failed") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto w-full max-w-lg px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-50">
              <XCircle className="size-7 text-rose-500" aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
              {t("sellerDash.shop.productsLoadFailed")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {t("sellerDash.shop.productsLoadFailedDesc")}
            </p>
            <Button className="mt-6 h-11" onClick={() => void loadProfile()}>
              {t("sellerDash.shop.retry")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // ------------------------------------------------- application under review
  if (profileState === "denied") {
    // No seller row at all → the application form is the correct next step.
    if (!application) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
          <AppHeader />
          <ShopOnboarding onOpened={loadProfile} />
        </div>
      );
    }
    return renderGate(application.status, application.reason);
  }


  // `profileState === "ok"` guarantees a payload; this keeps the type honest.
  if (!profile) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto w-full max-w-lg px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {t("sellerDash.shop.productsLoadFailed")}
            </h1>
            <Button className="mt-6 h-11" onClick={() => void loadProfile()}>
              {t("sellerDash.shop.retry")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------- onboarding
  if (!shop) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <ShopOnboarding onOpened={loadProfile} />
      </div>
    );
  }

  // ------------------------------------------------- approval gate (spec §11)
  if (profile.seller.status !== "approved") {
    return renderGate(profile.seller.status, profile.seller.rejectionReason ?? null);
  }

  // ---------------------------------------------------------------- dashboard
  const terminal = (product: StoreProduct) => TERMINAL_STATUSES.includes(product.status);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-500">
          <Package className="size-4 text-[#10B981]" aria-hidden="true" />
          {t("sellerDash.shop.eyebrow")}
        </p>

        <ShopIdentityCard shop={shop} verificationStatus={verificationStatus} onUpdated={loadProfile} />

        {/* facts: what the seller is charged, what is covered, whether verified */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-slate-100">
              <BadgePercent className="size-5 text-slate-600" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{t("sellerDash.shop.cardFee")}</p>
              <p className="text-sm font-semibold text-slate-900">
                {Number.isFinite(shop.commissionRate)
                  ? t("sellerDash.shop.cardFeeValue", {
                      rate: (shop.commissionRate * 100).toLocaleString(),
                    })
                  : t("sellerDash.shop.cardFeeUnknown")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
              <ShieldCheck className="size-5 text-[#10B981]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{t("sellerDash.shop.cardReturnPolicy")}</p>
              <p className="text-sm font-semibold text-slate-900">
                {t("sellerDash.shop.cardReturnValue")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-emerald-50">
              <ShieldCheck className="size-5 text-emerald-700" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">{t("verification.sellerVerificationTitle")}</p>
              <p className="text-sm font-semibold text-slate-900">
                {verificationStatus === "pending"
                  ? t("sellerDash.shop.verifyPendingHint")
                  : verificationStatus === "verified"
                    ? t("sellerDash.shop.verifyVerifiedText")
                    : t("verification.sellerVerificationBadge")}
              </p>
            </div>
            {verificationStatus !== "pending" && verificationStatus !== "verified" && (
              <Button
                variant="ghost"
                className="h-11 shrink-0 px-3 text-xs font-medium text-[#047857] hover:bg-emerald-50"
                onClick={() => {
                  setVerifyAtEvidence(false);
                  setVerifyTarget({ kind: "seller" });
                }}
              >
                {verificationStatus === "rejected"
                  ? t("verification.resubmitForVerification")
                  : t("verification.submitForVerification")}
              </Button>
            )}
          </div>
        </div>

        {/* products */}
        <section className="mt-8" aria-labelledby="shop-products-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 id="shop-products-title" className="text-base font-semibold text-slate-900">
                {t("sellerDash.shop.productsTitle")}
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500">
                {t("sellerDash.shop.productsCount", { count: counts.all })}
              </span>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("sellerDash.shop.searchPlaceholder")}
                  className="h-11 rounded-[10px] border-slate-200 bg-white pl-9"
                  aria-label={t("sellerDash.shop.searchAria")}
                  type="search"
                />
              </div>
              <Button
                className="h-11 shrink-0 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("sellerDash.shop.ctaAddProduct")}
              </Button>
            </div>
          </div>

          {/* status filters — server-shaped product states */}
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t("sellerDash.shop.productsTitle")}>
            {statusFilters.map((filter) => {
              const active = statusFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(filter.key)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-[#10B981] bg-[#10B981] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {filter.label}
                  <span className={active ? "text-white/80" : "text-slate-500"}>{filter.count}</span>
                </button>
              );
            })}
          </div>

          {products === undefined && (
            <div className="mt-4 grid gap-2" aria-busy="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-20 animate-pulse rounded-xl bg-slate-100" />
              ))}
              <p className="sr-only">{t("sellerDash.shop.productsLoading")}</p>
            </div>
          )}

          {products !== undefined && productsFailed && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm font-semibold text-slate-900">
                {t("sellerDash.shop.productsLoadFailed")}
              </p>
              <p className="mt-1 text-sm text-slate-500">{t("sellerDash.shop.productsLoadFailedDesc")}</p>
              <Button className="mt-4 h-11" onClick={() => void loadProducts()}>
                {t("sellerDash.shop.retry")}
              </Button>
            </div>
          )}

          {products !== undefined && !productsFailed && counts.all === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#ECFDF5]">
                <Package className="size-6 text-[#10B981]" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">
                {t("sellerDash.shop.emptyTitle")}
              </h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                {t("sellerDash.shop.emptyDesc")}
              </p>
              <Button
                className="mt-5 h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("sellerDash.shop.ctaAddFirst")}
              </Button>
            </div>
          )}

          {products !== undefined && !productsFailed && counts.all > 0 && visibleProducts.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
              <h3 className="text-sm font-semibold text-slate-900">
                {t("sellerDash.shop.emptyFilteredTitle")}
              </h3>
              <p className="mt-1.5 text-sm text-slate-500">{t("sellerDash.shop.emptyFilteredDesc")}</p>
            </div>
          )}

          {/* desktop: table */}
          {visibleProducts.length > 0 && (
            <div className="mt-4 hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 hover:bg-transparent">
                    <TableHead className="text-xs font-medium text-slate-500">
                      {t("sellerDash.shop.colProduct")}
                    </TableHead>
                    <TableHead className="text-xs font-medium text-slate-500">
                      {t("sellerDash.shop.colPrice")}
                    </TableHead>
                    <TableHead className="text-xs font-medium text-slate-500">
                      {t("sellerDash.shop.colStock")}
                    </TableHead>
                    <TableHead className="text-xs font-medium text-slate-500">
                      {t("sellerDash.shop.colStatus")}
                    </TableHead>
                    <TableHead className="text-right text-xs font-medium text-slate-500">
                      {t("sellerDash.shop.colActions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleProducts.map((product) => {
                    const available = availableOf(product);
                    return (
                      <TableRow key={product.id} className="border-slate-100">
                        <TableCell className="max-w-[22rem]">
                          <div className="flex items-center gap-3">
                            {product.primaryImage ? (
                              <img
                                src={product.primaryImage.thumbUrl || product.primaryImage.url}
                                alt=""
                                className="size-11 shrink-0 rounded-[10px] object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-slate-100">
                                <ImageOff className="size-4 text-slate-300" aria-hidden="true" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">
                                {product.name}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {PRODUCT_CATEGORY_META[
                                  (product.categorySlug ?? product.category) as StoreProduct["category"]
                                ]?.label ?? product.categorySlug ?? product.category}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">
                          {formatBaht(product.price)}
                          <span className="text-xs font-normal text-slate-500"> / {product.unit}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums text-slate-600">
                          {available}
                        </TableCell>
                        <TableCell>{renderStatus(product)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-11 gap-1.5 px-2.5 text-xs text-slate-600"
                              onClick={() => void handleTogglePublish(product)}
                              disabled={
                                togglingId === product.id ||
                                product.status === "pending_review" ||
                                terminal(product)
                              }
                              aria-label={toggleLabel(product)}
                            >
                              {togglingId === product.id ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : product.status === "published" ? (
                                <EyeOff className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Eye className="size-3.5" aria-hidden="true" />
                              )}
                              {toggleLabel(product)}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-11 text-slate-500"
                              onClick={() => {
                                setEditing(product);
                                setFormOpen(true);
                              }}
                              disabled={terminal(product)}
                              aria-label={`${t("sellerDash.shop.actionEdit")} ${product.name}`}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-11 text-slate-500 hover:bg-red-50 hover:text-red-600"
                              onClick={() => setDeleting(product)}
                              aria-label={t("sellerDash.shop.deleteAria", { name: product.name })}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* mobile: cards */}
          {visibleProducts.length > 0 && (
            <div className="mt-4 grid gap-3 md:hidden">
              {visibleProducts.map((product) => {
                const available = availableOf(product);
                return (
                  <div key={product.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start gap-3">
                      {product.primaryImage ? (
                        <img
                          src={product.primaryImage.thumbUrl || product.primaryImage.url}
                          alt=""
                          className="size-14 shrink-0 rounded-[10px] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-slate-100">
                          <ImageOff className="size-5 text-slate-300" aria-hidden="true" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {PRODUCT_CATEGORY_META[
                            (product.categorySlug ?? product.category) as StoreProduct["category"]
                          ]?.label ?? product.categorySlug ?? product.category}
                          {product.images && product.images.length > 0
                            ? ` · ${t("sellerDash.shop.imagesCount", { count: product.images.length })}`
                            : ` · ${t("sellerDash.shop.noImages")}`}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold tabular-nums text-slate-900">
                            {formatBaht(product.price)}
                            <span className="text-xs font-normal text-slate-500"> / {product.unit}</span>
                          </p>
                          <span className="text-xs text-slate-500">
                            · {t("sellerDash.shop.mobileStock", { available })}
                          </span>
                          {renderStatus(product)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                      <Button
                        size="sm"
                        className="h-11 flex-1 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669] disabled:bg-slate-200 disabled:text-slate-500"
                        onClick={() => void handleTogglePublish(product)}
                        disabled={
                          togglingId === product.id ||
                          product.status === "pending_review" ||
                          terminal(product)
                        }
                      >
                        {togglingId === product.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : product.status === "published" ? (
                          <EyeOff className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Eye className="size-3.5" aria-hidden="true" />
                        )}
                        {toggleLabel(product)}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 flex-1 gap-1.5 border-slate-200 text-slate-600"
                        onClick={() => {
                          setEditing(product);
                          setFormOpen(true);
                        }}
                        disabled={terminal(product)}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        {t("sellerDash.shop.actionEdit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(product)}
                        aria-label={t("sellerDash.shop.deleteAria", { name: product.name })}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        shop={shop}
        product={editing}
        onSaved={(saved) => {
          setProducts((prev) => {
            const rows = prev ?? [];
            return rows.some((p) => p.id === saved.id)
              ? rows.map((p) => (p.id === saved.id ? saved : p))
              : [saved, ...rows];
          });
        }}
      />

      <ShopVerificationDialog
        open={verifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVerifyTarget(null);
        }}
        onSubmitted={loadProfile}
        startAtEvidence={verifyAtEvidence}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sellerDash.shop.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sellerDash.shop.deleteDesc", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => void handleDelete()}
              disabled={deletingBusy}
            >
              {deletingBusy ? t("sellerDash.shop.deleting") : t("sellerDash.shop.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
