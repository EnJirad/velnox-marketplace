import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { SITE_URLS, apiBaseUrl } from "@velnox/shared/lib/sites";
import {
  ArrowRight,
  Camera,
  Clock,
  FileCheck,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Store,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { toast } from "sonner";

const API_BASE = apiBaseUrl;

interface RequireRoleProps {
  role: "seller" | "center";
  children: ReactNode;
}

function LoadingGate() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </main>
  );
}

function GateCard({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Lock;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC] px-4 text-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
          <Icon className="size-7 text-[#10B981]" />
        </span>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p>
        {children}
        <Button variant="ghost" className="mt-4 w-full text-slate-500" asChild>
          <a href={SITE_URLS.velshop}>{t("gate.sellerBackToShop")}</a>
        </Button>
      </div>
    </div>
  );
}

export function RequireRole({ role, children }: RequireRoleProps) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();
  const { t } = useLanguage();

  const [seller, setSeller] = useState<{ status: string | null; rejectionReason: string | null; correctionReason: string | null } | null>(null);
  const [sellerLoading, setSellerLoading] = useState(true);
  const [sellerLoaded, setSellerLoaded] = useState(false);
  const [sellerError, setSellerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [shopName, setShopName] = useState("");
  const [ownerStatus, setOwnerStatus] = useState<{ ownerExists: boolean; configured: boolean } | null>(null);
  // Seller onboarding form state
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2 | 3>(0);
  // Step 0 — Store info
  const [sellerFirstName, setSellerFirstName] = useState("");
  const [sellerLastName, setSellerLastName] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [shopDescription, setShopDescription] = useState("");
  const [shopCategory, setShopCategory] = useState("");
  const [shopAddress, setShopAddress] = useState({ line1: "", line2: "", subdistrict: "", district: "", city: "", state: "", postalCode: "", country: "TH" });
  // Step 2 — Identity
  const [sellerIdNumber, setSellerIdNumber] = useState("");
  const [sellerBirthdate, setSellerBirthdate] = useState("");
  // Step 3 — Documents
  const [sellerIdFront, setSellerIdFront] = useState<File | null>(null);
  const [sellerIdBack, setSellerIdBack] = useState<File | null>(null);
  const [sellerSelfie, setSellerSelfie] = useState<File | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    setSellerLoading(true);

    if (role === "center") {
      fetch(`${API_BASE}/admin/bootstrap-status`, { credentials: "include" })
        .then((r) => r.json())
        .then((s) => { if (alive) setOwnerStatus(s.data ?? s); })
        .catch(() => { if (alive) setOwnerStatus({ ownerExists: false, configured: false }); });
    }

    fetch(`${API_BASE}/seller/status`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((s) => {
        if (!alive) return;
        // data=null means "authenticated but no seller application" — this is NOT loading
        setSeller(s.data ?? null);
        setSellerError(null);
        setSellerLoaded(true);
      })
      .catch((err) => {
        console.error("[seller] status fetch failed:", err);
        if (alive) {
          setSeller({ status: null, rejectionReason: null, correctionReason: null });
          setSellerError("ไม่สามารถตรวจสอบสถานะร้านค้าได้ กรุณาลองใหม่");
          setSellerLoaded(true);
        }
      })
      .finally(() => { if (alive) setSellerLoading(false); });

    return () => { alive = false; };
  }, [isAuthenticated, role]);

  if (isLoading) return <LoadingGate />;

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  const userRole = user?.role;

  // ── center ──
  if (role === "center") {
    const canCenter = userRole === "owner" || userRole === "admin" || userRole === "staff";
    if (canCenter) return children;
    if (ownerStatus === null) return <LoadingGate />;

    if (ownerStatus.ownerExists) {
      return <GateCard icon={Lock} title={t("gate.centerLockedTitle")} desc={t("gate.centerLockedDesc")} />;
    }

    if (!ownerStatus.configured) {
      return (
        <GateCard icon={ShieldCheck} title={t("gate.centerBootstrapTitle")} desc={t("gate.centerBootstrapMissing")} />
      );
    }

    const handleClaimOwner = async (event: FormEvent) => {
      event.preventDefault();
      if (!bootstrapCode.trim()) return;
      setBusy(true);
      try {
        await fetch(`${API_BASE}/admin/claim-owner`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bootstrapCode: bootstrapCode.trim() }),
        });
        toast.success(t("gate.centerBootstrapSuccess"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("gate.centerBootstrapInvalid"));
      } finally {
        setBusy(false);
      }
    };

    return (
      <GateCard icon={KeyRound} title={t("gate.centerBootstrapTitle")} desc={t("gate.centerBootstrapDesc")}>
        <form onSubmit={handleClaimOwner} className="mt-6 grid gap-3 text-left">
          <div className="grid gap-2">
            <Label htmlFor="bootstrap-code" className="text-xs font-medium text-slate-500">
              {t("gate.centerBootstrapCode")}
            </Label>
            <Input
              id="bootstrap-code"
              type="password"
              autoComplete="off"
              value={bootstrapCode}
              onChange={(e) => setBootstrapCode(e.target.value)}
              placeholder={t("gate.centerBootstrapCodePlaceholder")}
              className="h-11 rounded-[10px] border-slate-200"
              disabled={busy}
            />
          </div>
          <Button type="submit" className="mt-1 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" disabled={busy || !bootstrapCode.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("gate.centerBootstrapSubmit")}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
        </form>
      </GateCard>
    );
  }

  // ── seller ──
  // Show spinner only while the initial fetch is in-flight.
  // After fetch completes (sellerLoaded=true), seller=null means "no application" → show registration.
  if (sellerLoading && !sellerLoaded) {
    return <LoadingGate />;
  }

  // Fetch completed with an error
  if (sellerError && sellerLoaded) {
    return (
      <GateCard icon={XCircle} title="เกิดข้อผิดพลาด" desc={sellerError}>
      <Button
        className="mt-4 gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
        onClick={() => {
          setSellerLoading(true);
          setSellerLoaded(false);
          setSellerError(null);
          setSeller(null);
          fetch(`${API_BASE}/seller/status`, { credentials: "include" })
            .then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            })
            .then((s) => { const d = s.data; setSeller(d ? { status: d.status, rejectionReason: d.rejectionReason || null, correctionReason: d.correctionReason || null } : null); setSellerError(null); setSellerLoaded(true); })
            .catch(() => { setSellerError("ไม่สามารถตรวจสอบสถานะได้ กรุณาลองใหม่"); setSellerLoaded(true); })
            .finally(() => setSellerLoading(false));
        }}
      >
        ลองใหม่
      </Button>
      </GateCard>
    );
  }

  // seller === null means "authenticated but no seller application" → fall through to registration form below
  if (seller?.status === "approved") return children;

  if (seller?.status === "pending") {
    return <GateCard icon={Clock} title="สมัครร้านค้าแล้ว" desc="ระบบได้รับคำขอของคุณแล้ว รอการตรวจสอบจากทีมงาน Velnox">
      <div className="mt-4 rounded-[10px] bg-amber-50 px-4 py-3 text-left">
        <p className="text-sm font-medium text-amber-800">สถานะ: รอการตรวจสอบ</p>
        <p className="mt-1 text-xs text-amber-600">ทีมงานจะตรวจสอบคำขอของคุณภายใน 1-3 วันทำการ</p>
      </div>
    </GateCard>;
  }

  if (seller?.status === "under_review") {
    return <GateCard icon={Clock} title="กำลังตรวจสอบคำขอ" desc="ทีมงาน Velnox กำลังตรวจสอบคำขอเปิดร้านค้าของคุณ">
      <div className="mt-4 rounded-[10px] bg-blue-50 px-4 py-3 text-left">
        <p className="text-sm font-medium text-blue-800">สถานะ: อยู่ระหว่างการตรวจสอบ</p>
        <p className="mt-1 text-xs text-blue-600">กรุณารอผลการตรวจสอบ คุณจะได้รับการแจ้งเตือนเมื่อมีผลลัพธ์</p>
      </div>
    </GateCard>;
  }

  if (seller?.status === "needs_correction") {
    // Allow re-apply: fall through to the registration form below with correction info
  }

  if (seller?.status === "rejected") {
    // Allow re-apply: fall through to the registration form below with rejection info
  }

  if (seller?.status === "suspended") {
    return <GateCard icon={XCircle} title={t("gate.sellerSuspendedTitle")} desc={t("gate.sellerSuspendedDesc")} />;
  }

  const isRejected = seller?.status === "rejected";
  const needsCorrection = seller?.status === "needs_correction";

  // ── Multi-step seller onboarding ──

  const STEPS = [
    { label: "ข้อมูลร้าน", icon: Store },
    { label: "ข้อมูลผู้สมัคร", icon: User },
    { label: "ยืนยันตัวตน", icon: ShieldCheck },
    { label: "ตรวจสอบ", icon: FileCheck },
  ];

  const handleApply = async (event: FormEvent) => {
    event.preventDefault();
    if (!shopName.trim()) {
      toast.error(t("gate.sellerShopNameRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/seller/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName: shopName.trim(),
          shopDescription: shopDescription.trim() || undefined,
          shopCategory: shopCategory.trim() || undefined,
          shopAddress: shopAddress.line1.trim() ? shopAddress : undefined,
          firstName: sellerFirstName.trim() || undefined,
          lastName: sellerLastName.trim() || undefined,
          phone: sellerPhone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "สมัครไม่สำเร็จ กรุณาลองใหม่");
      }
      setApplySuccess(true);
      // Refetch seller status so the component reflects the new pending state
      try {
        const statusRes = await fetch(`${API_BASE}/seller/status`, { credentials: "include" });
        const statusData = await statusRes.json();
        if (statusData.data) {
          setSeller({
            status: statusData.data.status,
            rejectionReason: statusData.data.rejectionReason || null,
            correctionReason: statusData.data.correctionReason || null,
          });
        }
      } catch { /* non-fatal — success screen already shown */ }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  };

  // Success confirmation after application submitted
  if (applySuccess) {
    return (
      <GateCard
        icon={Clock}
        title="สมัครร้านค้าสำเร็จ"
        desc="ระบบได้รับคำขอของคุณแล้ว ทีมงานจะตรวจสอบและอนุมัติภายใน 1-3 วันทำการ"
      >
        <div className="mt-4 rounded-[10px] bg-amber-50 px-4 py-3 text-left">
          <p className="text-sm font-medium text-amber-800">สถานะ: รอการตรวจสอบ</p>
          <p className="mt-1 text-xs text-amber-600">คุณจะได้รับการแจ้งเตือนเมื่อบัญชีได้รับการอนุมัติ หรือมีการร้องขอให้แก้ไข</p>
        </div>
        <Button
          className="mt-5 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
          asChild
        >
          <a href="/">กลับไปหน้าหลัก</a>
        </Button>
      </GateCard>
    );
  }

  return (
    <GateCard
      icon={Store}
      title={isRejected ? t("gate.sellerRejectedTitle") : needsCorrection ? "แก้ไขคำขอสมัคร" : "สมัครเป็นพ่อค้า"}
      desc={isRejected ? t("gate.sellerRejectedDesc") : needsCorrection ? "คำขอสมัครของคุณต้องแก้ไขข้อมูลบางส่วน" : "กรอกข้อมูลด้านล่างเพื่อสมัครเป็นพ่อค้าบน Velnox"}
    >
      {isRejected && seller.rejectionReason && (
        <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
          {t("gate.sellerRejectedReason", { reason: seller.rejectionReason })}
        </p>
      )}
      {needsCorrection && seller.correctionReason && (
        <div className="mt-4 rounded-[10px] bg-amber-50 px-3 py-2.5">
          <p className="text-sm font-medium text-amber-800">⚠ ต้องแก้ไขข้อมูล</p>
          <p className="mt-1 text-xs text-amber-700">{seller.correctionReason}</p>
        </div>
      )}

      {/* Step indicator */}
      <div className="mt-5 flex items-center justify-center gap-1">
        {STEPS.map((step, i) => (
          <div key={i} className="flex items-center gap-1">
            <div
              className={`flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                i < onboardingStep
                  ? "bg-[#10B981] text-white"
                  : i === onboardingStep
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {i < onboardingStep ? "✓" : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-4 rounded ${i < onboardingStep ? "bg-[#10B981]" : "bg-slate-200"}`} />
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleApply} className="mt-5 grid gap-4 text-left">
        {/* Step 0: Store information */}
        {onboardingStep === 0 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <Store className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ข้อมูลร้านค้า</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shop-name" className="text-xs font-medium text-slate-500">ชื่อร้านค้า *</Label>
              <Input
                id="shop-name"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="เช่น ร้านสมชาย electronics"
                className="h-11 rounded-[10px] border-slate-200"
                disabled={busy}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shop-desc" className="text-xs font-medium text-slate-500">คำอธิบายร้านค้า</Label>
              <textarea
                id="shop-desc"
                value={shopDescription}
                onChange={(e) => setShopDescription(e.target.value)}
                placeholder="ขายสินค้าอิเล็กทรอนิกส์คุณภาพสูง"
                rows={2}
                className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#10B981]/20 focus:border-[#10B981]"
                disabled={busy}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shop-category" className="text-xs font-medium text-slate-500">ประเภทร้านค้า</Label>
              <Input
                id="shop-category"
                value={shopCategory}
                onChange={(e) => setShopCategory(e.target.value)}
                placeholder="เช่น อิเล็กทรอนิกส์, แฟชั่น, อาหาร"
                className="h-11 rounded-[10px] border-slate-200"
                disabled={busy}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-medium text-slate-500">ที่อยู่ร้านค้า</Label>
              <Input
                value={shopAddress.line1}
                onChange={(e) => setShopAddress((a) => ({ ...a, line1: e.target.value }))}
                placeholder="บ้านเลขที่ / ถนน"
                className="h-10 rounded-[10px] border-slate-200"
                disabled={busy}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={shopAddress.subdistrict}
                  onChange={(e) => setShopAddress((a) => ({ ...a, subdistrict: e.target.value }))}
                  placeholder="ตำบล/แขวง"
                  className="h-10 rounded-[10px] border-slate-200"
                  disabled={busy}
                />
                <Input
                  value={shopAddress.district}
                  onChange={(e) => setShopAddress((a) => ({ ...a, district: e.target.value }))}
                  placeholder="อำเภอ/เขต"
                  className="h-10 rounded-[10px] border-slate-200"
                  disabled={busy}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={shopAddress.city}
                  onChange={(e) => setShopAddress((a) => ({ ...a, city: e.target.value }))}
                  placeholder="จังหวัด"
                  className="h-10 rounded-[10px] border-slate-200"
                  disabled={busy}
                />
                <Input
                  value={shopAddress.postalCode}
                  onChange={(e) => setShopAddress((a) => ({ ...a, postalCode: e.target.value }))}
                  placeholder="รหัสไปรษณีย์"
                  className="h-10 rounded-[10px] border-slate-200"
                  disabled={busy}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Applicant information */}
        {onboardingStep === 1 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <User className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ข้อมูลผู้สมัคร</span>
            </div>
            {user?.email && (
              <div className="grid gap-2">
                <Label className="text-xs font-medium text-slate-500">อีเมล (จากบัญชี Google)</Label>
                <div className="flex h-11 items-center rounded-[10px] border border-slate-200 bg-slate-50 px-3">
                  <span className="text-sm text-slate-600">{user.email}</span>
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ยืนยันแล้ว</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="first-name" className="text-xs font-medium text-slate-500">ชื่อ *</Label>
                <Input
                  id="first-name"
                  value={sellerFirstName}
                  onChange={(e) => setSellerFirstName(e.target.value)}
                  placeholder="สมชาย"
                  className="h-11 rounded-[10px] border-slate-200"
                  disabled={busy}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="last-name" className="text-xs font-medium text-slate-500">นามสกุล *</Label>
                <Input
                  id="last-name"
                  value={sellerLastName}
                  onChange={(e) => setSellerLastName(e.target.value)}
                  placeholder="ใจดี"
                  className="h-11 rounded-[10px] border-slate-200"
                  disabled={busy}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone" className="text-xs font-medium text-slate-500">เบอร์โทรศัพท์ *</Label>
              <Input
                id="phone"
                type="tel"
                value={sellerPhone}
                onChange={(e) => setSellerPhone(e.target.value)}
                placeholder="081-234-5678"
                className="h-11 rounded-[10px] border-slate-200"
                disabled={busy}
                required
              />
            </div>
          </div>
        )}

        {/* Step 2: Identity verification */}
        {onboardingStep === 2 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <ShieldCheck className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ยืนยันตัวตน</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="id-number" className="text-xs font-medium text-slate-500">เลขบัตรประชาชน</Label>
              <Input
                id="id-number"
                value={sellerIdNumber}
                onChange={(e) => setSellerIdNumber(e.target.value)}
                placeholder="1-2345-67890-12-3"
                className="h-11 rounded-[10px] border-slate-200"
                disabled={busy}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="birthdate" className="text-xs font-medium text-slate-500">วันเกิด</Label>
              <Input
                id="birthdate"
                type="date"
                value={sellerBirthdate}
                onChange={(e) => setSellerBirthdate(e.target.value)}
                className="h-11 rounded-[10px] border-slate-200"
                disabled={busy}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-medium text-slate-500">เอกสารยืนยันตัวตน</Label>
              <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs text-amber-700">ระบบยืนยันตัวตน — เลือกไฟล์เพื่ออัปโหลด</p>
              </div>
              {[
                { label: "บัตรประชาชนด้านหน้า", file: sellerIdFront, set: setSellerIdFront },
                { label: "บัตรประชาชนด้านหลัง", file: sellerIdBack, set: setSellerIdBack },
                { label: "Selfie พร้อมบัตรประชาชน", file: sellerSelfie, set: setSellerSelfie },
              ].map((item) => (
                <div key={item.label} className="grid gap-2">
                  <Label className="text-xs font-medium text-slate-500">{item.label}</Label>
                  <label
                    className={`flex h-20 cursor-pointer items-center justify-center rounded-[10px] border-2 border-dashed transition-colors ${
                      item.file ? "border-[#10B981] bg-[#ECFDF5]" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => item.set(e.target.files?.[0] ?? null)}
                      disabled={busy}
                    />
                    {item.file ? (
                      <span className="text-sm font-medium text-[#047857]">✓ {item.file.name}</span>
                    ) : (
                      <span className="text-xs text-slate-400">คลิกเพื่อเลือกรูป</span>
                    )}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Review before submit */}
        {onboardingStep === 3 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <FileCheck className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ตรวจสอบข้อมูลก่อนส่ง</span>
            </div>
            {/* Store summary */}
            <div className="rounded-[10px] border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-500">ร้านค้า</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{shopName}</p>
              {shopDescription && <p className="mt-0.5 text-xs text-slate-500">{shopDescription}</p>}
              {shopCategory && <p className="mt-0.5 text-xs text-slate-500">ประเภท: {shopCategory}</p>}
              {shopAddress.line1 && (
                <p className="mt-0.5 text-xs text-slate-400">{[shopAddress.line1, shopAddress.district, shopAddress.city].filter(Boolean).join(", ")}</p>
              )}
            </div>
            {/* Applicant summary */}
            <div className="rounded-[10px] border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-500">ผู้สมัคร</p>
              <p className="mt-1 text-sm text-slate-900">{sellerFirstName} {sellerLastName}</p>
              {user?.email && <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>}
              {sellerPhone && <p className="mt-0.5 text-xs text-slate-500">{sellerPhone}</p>}
            </div>
            {/* Identity summary */}
            <div className="rounded-[10px] border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-500">การยืนยันตัวตน</p>
              <div className="mt-1 space-y-1">
                <p className="text-xs text-slate-600">บัตรประชาชน: {sellerIdFront ? "✓ อัปโหลดแล้ว" : "— ยังไม่ได้อัปโหลด"}</p>
                <p className="text-xs text-slate-600">Selfie: {sellerSelfie ? "✓ อัปโหลดแล้ว" : "— ยังไม่ได้อัปโหลด"}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400">ตรวจสอบข้อมูลให้ถูกต้องก่อนกดส่งคำขอสมัคร</p>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="mt-1 grid gap-2">
          {onboardingStep < 3 ? (
            <Button
              type="button"
              className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => {
                if (onboardingStep === 0 && !shopName.trim()) {
                  toast.error(t("gate.sellerShopNameRequired"));
                  return;
                }
                setOnboardingStep((s) => (s + 1) as 0 | 1 | 2 | 3);
              }}
              disabled={busy}
            >
              ถัดไป
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              className="gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy || !shopName.trim()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
ส่งใบสมัคร
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          )}
          {onboardingStep > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="text-slate-500"
              onClick={() => setOnboardingStep((s) => (s - 1) as 0 | 1 | 2 | 3)}
              disabled={busy}
            >
              ย้อนกลับ
            </Button>
          )}
        </div>
      </form>
    </GateCard>
  );
}
