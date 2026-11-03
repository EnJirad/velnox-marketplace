import { AppHeader } from "@velnox/shared/components/AppHeader";
import { SITE_URLS } from "@velnox/shared/lib/sites";
import { useSearchParams } from "react-router";
import { ProductFormDialog } from "@velnox/shared/components/seller/ProductFormDialog";
import { EvidenceUploader, type EvidenceFile } from "@velnox/shared/components/seller/EvidenceUploader";

import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { api } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  PRODUCT_CATEGORY_META,
  formatBaht,
  type SellerProfile,
  type StoreProduct,
  type StoreProductStatus,
  type StoreShop,
  type VerificationStatus,
} from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
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
  Store,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const EMPTY_ONBOARD = { shopName: "", slug: "", description: "", taxId: "" };

export default function MyShop() {
  const { t } = useLanguage();
  const mySellerProfile = useAction(api.commerce.mySellerProfile);
  const openShop = useAction(api.commerce.openShop);
  const listProducts = useAction(api.commerce.listProducts);
  const setStatus = useAction(api.commerce.setProductStatusAction);
  const submitSellerVerification = useAction(api.seller.submitVerification);
  const confirmEvidence = useAction(api.seller.evidenceConfirm);
  const fetchEvidence = useAction(api.seller.evidenceList);
  const deleteProduct = useAction(api.commerce.deleteProductAction);

  const [profile, setProfile] = useState<SellerProfile | null | undefined>(undefined);
  const [sellerVerifData, setSellerVerifData] = useState<any>(null);

  // Persist evidence metadata to backend after R2 upload succeeds
  const handleEvidenceUploaded = useCallback(
    async (info: { objectKey: string; cdnUrl: string; filename: string; contentType: string; fileSize: number; purpose: string }) => {
      console.log(`[VERIFICATION UPLOAD] confirmation started purpose=${info.purpose} key=${info.objectKey}`);
      try {
        const res = await confirmEvidence({
          objectKey: info.objectKey,
          publicUrl: info.cdnUrl,
          filename: info.filename,
          contentType: info.contentType,
          fileSize: info.fileSize,
        });
        console.log(`[VERIFICATION UPLOAD] confirmation completed status=200 purpose=${info.purpose}`);
      } catch (err) {
        console.error(`[VERIFICATION UPLOAD] confirmation failed purpose=${info.purpose}`, err);
        toast.error(
        t("sellerDash.shop.toastEvidenceFailed", { filename: info.filename }),
      );
      }
    },
    [confirmEvidence],
  );
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [onboard, setOnboard] = useState(EMPTY_ONBOARD);
  const [opening, setOpening] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [deleting, setDeleting] = useState<StoreProduct | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | StoreProductStatus>("all");
  // Seller / shop identity verification — Velnox runs ONE verification system.
  // There is no product-level verification and no products.is_v.
  const [verifyTarget, setVerifyTarget] = useState<{ kind: "seller" } | null>(null);
  const [verifyNotes, setVerifyNotes] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  // Multi-step identity verification
  const [verifyStep, setVerifyStep] = useState<1 | 2 | 3>(1);
  const [personalInfo, setPersonalInfo] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    address: "",
  });
  const [evidenceHydrated, setEvidenceHydrated] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const shop: StoreShop | null = profile?.shops[0] ?? null;

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });
  }, [products, query, statusFilter]);

  const statusFilters: Array<{ key: "all" | StoreProductStatus; label: string }> = [
    { key: "all", label: t("productModeration.filterAll") },
    { key: "draft", label: t("productModeration.statusDraft") },
    { key: "pending_review", label: t("productModeration.statusPendingReview") },
    { key: "published", label: t("productModeration.statusPublished") },
    { key: "rejected", label: t("productModeration.statusRejected") },
    { key: "suspended", label: t("productModeration.statusSuspended") },
  ];

  const publishedCount = products.filter((p) => p.status === "published").length;
  const pendingCount = products.filter((p) => p.status === "pending_review").length;
  const rejectedCount = products.filter((p) => p.status === "rejected").length;

  const reloadProducts = useCallback(async () => {
    try {
      const list = await listProducts({ mine: true, limit: 200 });
      setProducts(list);
    } catch (error) {
      console.error("Load products error:", error);
    }
  }, [listProducts]);

  useEffect(() => {
    let alive = true;
    mySellerProfile()
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        if (p) reloadProducts();
      })
      .catch(() => alive && setProfile(null));
    return () => {
      alive = false;
    };
  }, [mySellerProfile, reloadProducts]);

  // Hydrate persisted evidence from DB so images survive refresh and show in Step 2
  useEffect(() => {
    if (!profile || evidenceHydrated) return;
    let cancelled = false;
    const vs = (profile.seller as any)?.verificationStatus as string | undefined;
    // Only hydrate if seller is pending/verified/rejected/suspended or has attempted verification
    // Also hydrate for unverified so previously uploaded evidence that failed submit can be retried
    fetchEvidence()
      .then((rows: any[]) => {
        if (cancelled || !rows?.length) {
          if (!cancelled) setEvidenceHydrated(true);
          return;
        }
        // Map DB rows to EvidenceFile shape (hydrated entries have no File object)
        const hydrated: EvidenceFile[] = rows.map((r: any) => ({
          id: `hydrated_${r.id ?? r.key}`,
          filename: String(r.key).split("/").pop() || "evidence",
          contentType: r.content_type || "image/jpeg",
          fileSize: r.size ?? 0,
          purpose: r.purpose || "other",
          status: "uploaded" as const,
          objectKey: r.key,
          cdnUrl: r.url,
          previewUrl: r.url,
        }));
        if (!cancelled) {
          setEvidenceFiles(hydrated);
          setEvidenceHydrated(true);
          console.log(`[VERIFICATION UPLOAD] hydrated ${hydrated.length} evidence from DB`);
        }
      })
      .catch(() => {
        if (!cancelled) setEvidenceHydrated(true);
      });
    return () => { cancelled = true; };
  }, [profile, evidenceHydrated, fetchEvidence]);

  // Deep link from the seller notification bell. A VelCenter correction request
  // reaches the seller as /seller/shop?verification=<id>&correction=1, so this
  // opens the verification wizard on the case that must be fixed. The identifier
  // only selects the flow — ownership is enforced by the backend when the wizard
  // loads its evidence, and a seller has exactly one verification case at a time.
  useEffect(() => {
    const verificationId = searchParams.get("verification");
    if (!verificationId) return;
    setVerifyTarget({ kind: "seller" });
    if (searchParams.get("correction") === "1") setVerifyStep(1);
    const next = new URLSearchParams(searchParams);
    next.delete("verification");
    next.delete("correction");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleOpenShop = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onboard.shopName.trim()) {
      toast.error(t("sellerDash.shop.toastShopNameRequired"));
      return;
    }
    setOpening(true);
    try {
      await openShop({
        shopName: onboard.shopName.trim(),
        slug: onboard.slug.trim() || undefined,
        description: onboard.description.trim() || undefined,
        taxId: onboard.taxId.trim() || undefined,
      });
      toast.success(t("sellerDash.shop.toastShopOpened"));
      setProfile(await mySellerProfile());
    } catch (error) {
      console.error("Open shop error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastShopOpenFailed"));
    } finally {
      setOpening(false);
    }
  };

  const handleTogglePublish = async (product: StoreProduct) => {
    setTogglingId(product.id);
    try {
      if (product.status === "published") {
        const updated = await setStatus({ productId: product.id, status: "draft" });
        toast.success(t("productModeration.unpublishedToast"));
        if (updated) {
          setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }
        return;
      }
      // Submit for review: seller can only send 'pending_review' (backend enforces state machine).
      // If auto-approval is on, backend will set status to 'published' directly.
      const updated = await setStatus({ productId: product.id, status: "pending_review" });
      toast.success(
        updated?.status === "published" ? t("sellerDash.shop.toastPublished") : t("productModeration.submittedToast"),
      );
      if (updated) {
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
    } catch (error) {
      console.error("Toggle publish error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setTogglingId(null);
    }
  };

  /** Submit a seller- or product-level verification request. */
  /** Check if any evidence files are still uploading or pending */
  const hasUploadingFiles = evidenceFiles.some((f) => f.status === "uploading" || f.status === "pending");
  const hasUploadedFiles = evidenceFiles.some((f) => f.status === "uploaded" && f.cdnUrl);
  const hasErrorFiles = evidenceFiles.some((f) => f.status === "error");

  const handleSubmitVerification = async () => {
    if (!verifyTarget) return;

    // Block if uploads are still in progress
    if (hasUploadingFiles) {
      toast.error(t("sellerDash.shop.toastWaitUpload"));
      return;
    }

    // Require at least one successfully uploaded evidence file
    if (!hasUploadedFiles) {
      toast.error(t("sellerDash.shop.toastNeedEvidence"));
      return;
    }

    setVerifyBusy(true);
    try {
      // Collect evidence URLs from uploaded files
      const evidenceUrls = evidenceFiles
        .filter((f) => f.status === "uploaded" && f.cdnUrl)
        .map((f) => f.cdnUrl!);

      // Build evidence notes with categorized file counts
      const evidenceByPurpose = evidenceFiles
        .filter((f) => f.status === "uploaded")
        .reduce((acc, f) => {
          acc[f.purpose] = (acc[f.purpose] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);



      if (verifyTarget.kind === "seller") {
        await submitSellerVerification({ verificationType: "identity", evidenceUrls });
        toast.success(t("verification.sellerVerificationSubmitted"));
        setProfile(await mySellerProfile());
      }
      setVerifyTarget(null);
      setVerifyNotes("");
      setEvidenceFiles([]);
    } catch (error) {
      console.error("Verification submit error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setVerifyBusy(false);
    }
  };



  const handleDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await deleteProduct({ productId: deleting.id });
      toast.success(t("sellerDash.shop.toastDeleted"));
      setProducts((prev) => prev.filter((p) => p.id !== deleting.id));
      setDeleting(null);
    } catch (error) {
      console.error("Delete error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastDeleteFailed"));
    } finally {
      setDeletingBusy(false);
    }
  };

  /** Moderation-aware status badge (spec §16–17, §37). */
  const renderStatus = (product: StoreProduct) => {
    if (product.status === "published") {
      return (
        <Badge className="gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-emerald-50">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {t("productModeration.statusPublished")}
        </Badge>
      );
    }
    if (product.status === "pending_review") {
      return (
        <Badge className="gap-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-50">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {t("productModeration.statusPendingReview")}
        </Badge>
      );
    }
    if (product.status === "rejected") {
      return (
        <Badge className="gap-1 rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15 hover:bg-rose-50">
          <XCircle className="size-3" />
          {t("productModeration.statusRejected")}
        </Badge>
      );
    }
    if (product.status === "suspended") {
      return (
        <Badge className="gap-1 rounded-full bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/15 hover:bg-orange-50">
          <XCircle className="size-3" />
          {t("productModeration.statusSuspended")}
        </Badge>
      );
    }
    return (
      <Badge className="gap-1 rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
        <span className="size-1.5 rounded-full bg-slate-400" />
        {t("productModeration.statusDraft")}
      </Badge>
    );
  };

  const toggleLabel = (product: StoreProduct) => {
    if (product.status === "published") return t("sellerDash.shop.toggleUnpublish");
    if (product.status === "pending_review") return t("productModeration.statusPendingReview");
    if (product.status === "rejected") return t("productModeration.submitForReview");
    // suspended/archived are terminal (admin-only) — no seller transition
    if ((product.status as string) === "suspended") return t("productModeration.statusSuspended");
    if (product.status === "archived") return t("productModeration.statusArchived");
    return t("productModeration.submitForReview");
  };

  const isTerminal = (product: StoreProduct) =>
    (product.status as string) === "suspended" || product.status === "archived";

  // ---------------------------------------------------------------- onboarding
  if (profile === undefined) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="flex min-h-[60vh] items-center justify-center px-4">
          <Loader2 className="size-6 animate-spin text-slate-300" />
        </main>
      </div>
    );
  }

  if (profile === null || !shop) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
              <Store className="size-7 text-[#10B981]" />
            </span>
            <h1 className="mt-5 text-center text-xl font-bold tracking-tight text-slate-900">
              เปิดร้านค้าของคุณกับ Velnox
            </h1>
            <p className="mt-2 text-center text-sm leading-6 text-slate-500">
              เริ่มขายสินค้าที่หน้าร้าน velshop — ค่าธรรมเนียมเพียง 3% ต่อชิ้น
              พร้อมนโยบายตีกลับครอบคลุมไม่เกิน 10% ของยอดขาย
            </p>

            <form onSubmit={handleOpenShop} className="mt-6 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="shop-name">ชื่อร้านค้า *</Label>
                <Input
                  id="shop-name"
                  value={onboard.shopName}
                  onChange={(e) => setOnboard((p) => ({ ...p, shopName: e.target.value }))}
                  placeholder="เช่น ร้านสมุนไพรบ้านนา"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shop-slug">ที่อยู่หน้าร้าน (ไม่บังคับ)</Label>
                <Input
                  id="shop-slug"
                  value={onboard.slug}
                  onChange={(e) => setOnboard((p) => ({ ...p, slug: e.target.value }))}
                  placeholder="herb-home"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shop-desc">คำโปรยร้าน (ไม่บังคับ)</Label>
                <Textarea
                  id="shop-desc"
                  value={onboard.description}
                  onChange={(e) => setOnboard((p) => ({ ...p, description: e.target.value }))}
                  placeholder="สินค้าสมุนไพรคัดสรรจากสวนของเรา"
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shop-tax">เลขทะเบียนภาษี / เลขผู้เสียภาษี (ไม่บังคับ)</Label>
                <Input
                  id="shop-tax"
                  value={onboard.taxId}
                  onChange={(e) => setOnboard((p) => ({ ...p, taxId: e.target.value }))}
                  placeholder="เลข 13 หลัก"
                />
              </div>
              <Button
                type="submit"
                className="mt-2 gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]"
                disabled={opening}
              >
                {opening && <Loader2 className="size-4 animate-spin" />}
                เปิดร้านค้า
              </Button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // ------------------------------------------------ approval gate (spec §11)
  if (profile.seller.status !== "approved") {
    const pending = profile.seller.status === "pending";
    const rejected = profile.seller.status === "rejected";
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
                <Clock className="size-7 text-amber-500" />
              ) : (
                <XCircle className="size-7 text-rose-500" />
              )}
            </span>
            <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
              {pending ? t("gate.sellerPendingTitle") : t("gate.sellerRejectedTitle")}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {pending ? t("gate.sellerPendingDesc") : t("gate.sellerRejectedDesc")}
            </p>
            {rejected && profile.seller.rejectionReason && (
              <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
                {t("gate.sellerRejectedReason", { reason: profile.seller.rejectionReason })}
              </p>
            )}
            {profile.seller.status === "suspended" && (
              <>
                <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
                  {t("gate.sellerSuspendedTitle")}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {t("gate.sellerSuspendedDesc")}
                </p>
              </>
            )}
            <Button variant="ghost" className="mt-6 w-full text-slate-500" asChild>
              <a href={SITE_URLS.velshop}>{t("gate.sellerBackToShop")}</a>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // ------------------------------------------------------------------ dashboard
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <Store className="size-4 text-[#10B981]" />
              {t("sellerDash.shop.eyebrow")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {shop.name}
            </h1>
            <p className="mt-1.5 max-w-lg text-sm leading-6 text-slate-500">
              {shop.description || t("sellerDash.shop.subFallback")}
            </p>
          </div>
          <Button
            className="gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("sellerDash.shop.ctaAddProduct")}
          </Button>
        </div>

        {/* shop summary */}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
              <Store className="size-5 text-[#10B981]" />
            </span>
            <div>
              <p className="text-xs text-slate-400">{t("sellerDash.shop.cardShop")}</p>
              <p className="text-sm font-semibold text-slate-900">{shop.name}</p>
              {shop.slug && <p className="text-xs text-slate-400">velshop/{shop.slug}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-slate-100">
              <BadgePercent className="size-5 text-slate-600" />
            </span>
            <div>
              <p className="text-xs text-slate-400">{t("sellerDash.shop.cardFee")}</p>
              <p className="text-sm font-semibold text-slate-900">
                {t("sellerDash.shop.cardFeeValue", { rate: (shop.commissionRate * 100).toLocaleString("th-TH") })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
              <ShieldCheck className="size-5 text-[#10B981]" />
            </span>
            <div>
              <p className="text-xs text-slate-400">{t("sellerDash.shop.cardReturnPolicy")}</p>
              <p className="text-sm font-semibold text-slate-900">{t("sellerDash.shop.cardReturnValue")}</p>
            </div>
          </div>

          {/* Seller Verification Card */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className="flex size-10 items-center justify-center rounded-[10px] bg-emerald-50">
              <span className="text-base font-extrabold text-emerald-700">V</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400">{t("verification.sellerVerificationTitle")}</p>
              <p className="text-sm font-semibold text-slate-900">{t("verification.sellerVerificationBadge")}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <VerificationStatusLabel status={((profile?.seller as { verificationStatus?: VerificationStatus } | undefined)?.verificationStatus ?? "unverified") as VerificationStatus} />
              {(() => {
                const vs = ((profile?.seller as { verificationStatus?: VerificationStatus } | undefined)?.verificationStatus ?? "unverified") as VerificationStatus;
                if (vs === "pending" || vs === "verified") return null;
                return (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center text-[11px] font-medium text-[#10B981] underline-offset-2 hover:underline"
                    onClick={() => {
                      setVerifyTarget({ kind: "seller" });
                      setVerifyNotes("");
                    }}
                  >
                    {vs === "rejected" ? t("verification.resubmitForVerification") : t("verification.submitForVerification")}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>

        {/* products */}
        <section className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">{t("sellerDash.shop.productsTitle")}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {t("sellerDash.shop.productsCount", { count: products.length })}
              </span>
            </div>
            <div className="relative w-full sm:max-w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("sellerDash.shop.searchPlaceholder")}
                className="h-10 rounded-[10px] border-slate-200 bg-white pl-9"
                aria-label={t("sellerDash.shop.searchAria")}
              />
            </div>
          </div>

          {/* quick stats */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-lg sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <p className="text-lg font-bold tabular-nums text-slate-900">{products.length}</p>
              <p className="text-[11px] text-slate-400">{t("sellerDash.shop.statAll")}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <p className="text-lg font-bold tabular-nums text-emerald-600">{publishedCount}</p>
              <p className="text-[11px] text-slate-400">{t("sellerDash.shop.statPublished")}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <p className="text-lg font-bold tabular-nums text-amber-600">{pendingCount}</p>
              <p className="text-[11px] text-slate-400">{t("sellerDash.shop.statPending")}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <p className="text-lg font-bold tabular-nums text-rose-600">{rejectedCount}</p>
              <p className="text-[11px] text-slate-400">{t("sellerDash.shop.statRejected")}</p>
            </div>
          </div>

          {/* status filters — all / draft / pending / published / rejected / suspended */}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map((f) => {
              const active = statusFilter === f.key;
              const count = f.key === "all" ? products.length : products.filter((p) => p.status === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(f.key)}
                  className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-[#10B981] bg-[#10B981] text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {f.label}
                  <span className={`ml-1.5 tabular-nums ${active ? "text-white/70" : "text-slate-400"}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {products.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                <Package className="size-7 text-[#10B981]" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{t("sellerDash.shop.emptyTitle")}</h3>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                {t("sellerDash.shop.emptyDesc")}
              </p>
              <Button
                className="mt-6 gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" />
                {t("sellerDash.shop.ctaAddFirst")}
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <Search className="size-7 text-slate-300" />
              <h3 className="mt-4 text-base font-semibold text-slate-900">{t("sellerDash.shop.noMatchTitle")}</h3>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                {t("sellerDash.shop.noMatchDesc")}
              </p>
            </div>
          ) : (
            <>
            {/* Desktop: table */}
            <div className="mt-3 hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-slate-400">{t("sellerDash.shop.colProduct")}</TableHead>
                    <TableHead className="text-slate-400">{t("sellerDash.shop.colPrice")}</TableHead>
                    <TableHead className="text-slate-400">{t("sellerDash.shop.colStock")}</TableHead>
                    <TableHead className="text-slate-400">{t("sellerDash.shop.colStatus")}</TableHead>
                    <TableHead className="pr-5 text-right text-slate-400">{t("sellerDash.shop.colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const available = product.inventory?.available ?? product.inventory?.quantity ?? 0;
                    return (
                      <TableRow key={product.id} className="hover:bg-slate-50/60">
                        <TableCell className="pl-5">
                          <div className="flex min-w-0 items-center gap-3">
                            {product.primaryImage ? (
                              <img
                                src={product.primaryImage.thumbUrl || product.primaryImage.url}
                                alt={product.name}
                                className="size-12 shrink-0 rounded-[10px] object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-slate-100">
                                <ImageOff className="size-5 text-slate-300" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-slate-900">{product.name}</p>
                              <p className="truncate text-xs text-slate-400">
                                {PRODUCT_CATEGORY_META[(product.categorySlug ?? product.category) as StoreProduct["category"]]?.label
                                  ?? product.categorySlug ?? product.category}
                                {product.images && product.images.length > 0
                                  ? ` · ${t("sellerDash.shop.imagesCount", { count: product.images.length })}`
                                  : ` · ${t("sellerDash.shop.noImages")}`}
                                {product.supplier ? ` · ${product.supplier}` : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium tabular-nums text-slate-900">
                            {formatBaht(product.price)}
                            <span className="text-xs font-normal text-slate-400"> / {product.unit}</span>
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium tabular-nums text-slate-900">{available}</p>
                          <p className="text-xs text-slate-400">
                            {product.inventory?.reservedQuantity
                              ? t("sellerDash.shop.reservedInfo", {
                                  reserved: product.inventory.reservedQuantity,
                                  reorder: product.inventory.reorderLevel,
                                })
                              : t("sellerDash.shop.reorderInfo", { reorder: product.inventory?.reorderLevel ?? 0 })}
                          </p>
                        </TableCell>
                        <TableCell>
                          {renderStatus(product)}
                          {product.status === "rejected" && product.rejectionReason && (
                            <p className="mt-1 text-xs font-medium text-rose-600">
                              {t("productModeration.rejectedReason", { reason: product.rejectionReason })}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <div className="flex items-center justify-end gap-1.5">                              <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 border-slate-200 text-slate-600"
                              onClick={() => handleTogglePublish(product)}
                              disabled={togglingId === product.id || product.status === "pending_review" || isTerminal(product)}
                              title={isTerminal(product) ? t("productModeration.suspendedHint") : undefined}
                            >
                              {togglingId === product.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : product.status === "published" ? (
                                <EyeOff className="size-3.5" />
                              ) : (
                                <Eye className="size-3.5" />
                              )}
                              {toggleLabel(product)}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 border-slate-200 text-slate-600"
                              onClick={() => {
                                setEditing(product);
                                setFormOpen(true);
                              }}
                              disabled={isTerminal(product)}
                              title={isTerminal(product) ? t("productModeration.suspendedActionDisabled") : undefined}
                            >
                              <Pencil className="size-3.5" />
                              {t("sellerDash.shop.actionEdit")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => setDeleting(product)}
                              disabled={isTerminal(product)}
                              title={isTerminal(product) ? t("productModeration.suspendedDeleteDisabled") : undefined}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          {isTerminal(product) && (
                            <p className="mt-2 text-xs font-medium text-zinc-500">{t("productModeration.suspendedHint")}</p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: app-like product cards */}
            <div className="mt-3 space-y-3 md:hidden">
              {filteredProducts.map((product) => {
                const available = product.inventory?.available ?? product.inventory?.quantity ?? 0;
                const published = product.status === "published";
                const terminal = isTerminal(product);
                return (
                  <div
                    key={product.id}
                    className={`rounded-xl border bg-white p-4 transition-all duration-200 active:scale-[0.99] ${terminal ? "border-zinc-200 opacity-90" : "border-slate-200"}`}
                  >
                    <div className="flex items-center gap-3">
                      {product.primaryImage ? (
                        <img
                          src={product.primaryImage.thumbUrl || product.primaryImage.url}
                          alt={product.name}
                          className="size-14 shrink-0 rounded-[10px] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-slate-100">
                          <ImageOff className="size-5 text-slate-300" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {PRODUCT_CATEGORY_META[(product.categorySlug ?? product.category) as StoreProduct["category"]]?.label
                            ?? product.categorySlug ?? product.category}
                          {product.images && product.images.length > 0 ? ` · ${t("sellerDash.shop.imagesCount", { count: product.images.length })}` : ` · ${t("sellerDash.shop.noImages")}`}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold tabular-nums text-slate-900">
                            {formatBaht(product.price)}
                            <span className="text-xs font-normal text-slate-400"> / {product.unit}</span>
                          </p>
                          <span className="text-xs text-slate-400">· {t("sellerDash.shop.mobileStock", { available })}</span>
                          {renderStatus(product)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                      <Button
                        size="sm"
                        className="flex-1 gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669] disabled:bg-slate-200 disabled:text-slate-400"
                        onClick={() => handleTogglePublish(product)}
                        disabled={togglingId === product.id || product.status === "pending_review" || terminal}
                      >
                        {togglingId === product.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : product.status === "published" ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                        {toggleLabel(product)}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1.5 border-slate-200 text-slate-600"
                        onClick={() => {
                          setEditing(product);
                          setFormOpen(true);
                        }}
                        disabled={terminal}
                      >
                        <Pencil className="size-3.5" />
                        {t("sellerDash.shop.actionEdit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setDeleting(product)}
                        disabled={terminal}
                        aria-label={t("sellerDash.shop.deleteAria", { name: product.name })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </section>
      </main>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        shop={shop}
        product={editing}
        onSaved={(updated) => {
          setProducts((prev) => {
            const exists = prev.some((p) => p.id === updated.id);
            return exists ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated, ...prev];
          });
        }}
      />

      <Dialog open={verifyTarget !== null} onOpenChange={(open) => {
        if (!open) {
          setVerifyTarget(null);
          setVerifyNotes("");
          setEvidenceFiles([]);
          setVerifyStep(1);
          setPersonalInfo({ firstName: "", lastName: "", phone: "", address: "" });
        }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("verification.sellerVerificationTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("verification.sellerVerificationSeparateNote")}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  verifyStep >= s ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"
                }`}>{s}</div>
                {s < 3 && <div className={`h-0.5 w-8 rounded ${verifyStep > s ? "bg-emerald-600" : "bg-slate-200"}`} />}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-6 text-[10px] text-slate-400">
            <span className={verifyStep === 1 ? "font-medium text-emerald-600" : ""}>ข้อมูลส่วนตัว</span>
            <span className={verifyStep === 2 ? "font-medium text-emerald-600" : ""}>เอกสารยืนยันตัวตน</span>
            <span className={verifyStep === 3 ? "font-medium text-emerald-600" : ""}>ตรวจสอบและส่ง</span>
          </div>

          {/* Step 1: Personal Information */}
          {verifyStep === 1 && (
            <div className="grid gap-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="v-firstname">ชื่อ *</Label>
                  <Input id="v-firstname" value={personalInfo.firstName} onChange={(e) => setPersonalInfo((p) => ({ ...p, firstName: e.target.value }))} placeholder="ชื่อจริง" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="v-lastname">นามสกุล *</Label>
                  <Input id="v-lastname" value={personalInfo.lastName} onChange={(e) => setPersonalInfo((p) => ({ ...p, lastName: e.target.value }))} placeholder="นามสกุล" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="v-phone">เบอร์โทรศัพท์ *</Label>
                <Input id="v-phone" value={personalInfo.phone} onChange={(e) => setPersonalInfo((p) => ({ ...p, phone: e.target.value }))} placeholder="08X-XXX-XXXX" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="v-address">ที่อยู่ *</Label>
                <Textarea id="v-address" rows={2} value={personalInfo.address} onChange={(e) => setPersonalInfo((p) => ({ ...p, address: e.target.value }))} placeholder="ที่อยู่ตามบัตรประชาชน" />
              </div>
            </div>
          )}

          {/* Step 2: Identity Documents */}
          {verifyStep === 2 && (
            <div className="grid gap-4 pt-2">
              <EvidenceUploader
                purpose="id_card"
                label="บัตรประชาชน (หน้า)"
                description="ถ่ายรูปบัตรประชาชนด้านหน้า ชัดเจน อ่านข้อมูลได้"
                files={evidenceFiles.filter((f) => f.purpose === "id_card")}
                onFilesChange={(newFiles) => {
                  const other = evidenceFiles.filter((f) => f.purpose !== "id_card");
                  setEvidenceFiles([...other, ...newFiles]);
                }}
                onUploadSuccess={handleEvidenceUploaded}
                maxFiles={2}
              />
              <EvidenceUploader
                purpose="selfie_id"
                label="เซลฟี่คู่บัตรประชาชน"
                description="ถ่ายรูปตัวเองถือบัตรประชาชน ใบหน้าชัดเจน บัตรอ่านได้"
                files={evidenceFiles.filter((f) => f.purpose === "selfie_id")}
                onFilesChange={(newFiles) => {
                  const other = evidenceFiles.filter((f) => f.purpose !== "selfie_id");
                  setEvidenceFiles([...other, ...newFiles]);
                }}
                onUploadSuccess={handleEvidenceUploaded}
                maxFiles={2}
              />
              <div className="grid gap-1.5">
                <Label htmlFor="verification-notes">หมายเหตุเพิ่มเติม</Label>
                <Textarea id="verification-notes" rows={2} value={verifyNotes} onChange={(e) => setVerifyNotes(e.target.value)} placeholder="ข้อมูลเพิ่มเติม (ถ้ามี)..." />
              </div>
            </div>
          )}

          {/* Step 3: Review & Submit */}
          {verifyStep === 3 && (
            <div className="grid gap-4 pt-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">ข้อมูลส่วนตัว</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-400">ชื่อ:</span> {personalInfo.firstName} {personalInfo.lastName}</div>
                  <div><span className="text-slate-400">เบอร์โทร:</span> {personalInfo.phone}</div>
                  <div className="col-span-2"><span className="text-slate-400">ที่อยู่:</span> {personalInfo.address}</div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">เอกสารที่อัปโหลด</h4>
                <div className="flex flex-wrap gap-2">
                  {evidenceFiles.filter((f) => f.status === "uploaded").map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      ✓ {f.purpose === "id_card" ? "บัตรประชาชน" : f.purpose === "selfie_id" ? "เซลฟี่คู่บัตร" : f.purpose}
                    </span>
                  ))}
                  {evidenceFiles.filter((f) => f.status === "uploaded").length === 0 && (
                    <span className="text-xs text-rose-500">ยังไม่ได้อัปโหลดเอกสาร</span>
                  )}
                </div>
              </div>
              <p className="text-[11px] leading-5 text-slate-400">
                ข้อมูลจะถูกส่งให้ทีมตรวจสอบของ Velnox เท่านั้น ไม่เปิดเผยต่อลูกค้าหรือบุคคลที่สาม
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyTarget(null)} disabled={verifyBusy}>
              ยกเลิก
            </Button>
            {verifyStep > 1 && (
              <Button variant="outline" onClick={() => setVerifyStep((s) => (s - 1) as 1 | 2 | 3)} disabled={verifyBusy}>
                ย้อนกลับ
              </Button>
            )}
            {verifyStep < 3 ? (
              <Button
                className="gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]"
                onClick={() => setVerifyStep((s) => (s + 1) as 1 | 2 | 3)}
                disabled={
                  (verifyStep === 1 && (!personalInfo.firstName || !personalInfo.lastName || !personalInfo.phone || !personalInfo.address)) ||
                  (verifyStep === 2 && !hasUploadedFiles)
                }
              >
                ถัดไป
              </Button>
            ) : (
              <Button className="gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]" onClick={() => void handleSubmitVerification()} disabled={verifyBusy || hasUploadingFiles || !hasUploadedFiles}>
                {(verifyBusy || hasUploadingFiles) && <Loader2 className="size-4 animate-spin" />}
                {hasUploadingFiles ? "กำลังอัปโหลด..." : t("verification.submitForVerification")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              onClick={handleDelete}
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
