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

  const [seller, setSeller] = useState<{ status: string | null; rejectionReason: string | null } | null>(null);
  const [sellerLoading, setSellerLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [shopName, setShopName] = useState("");
  const [ownerStatus, setOwnerStatus] = useState<{ ownerExists: boolean; configured: boolean } | null>(null);
  // Seller onboarding form state
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2 | 3>(0);
  const [sellerFirstName, setSellerFirstName] = useState("");
  const [sellerLastName, setSellerLastName] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [sellerIdNumber, setSellerIdNumber] = useState("");
  const [sellerBirthdate, setSellerBirthdate] = useState("");
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
      .then((r) => r.json())
      .then((s) => { if (alive) setSeller(s); })
      .catch(() => { if (alive) setSeller({ status: null, rejectionReason: null }); })
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
  if (sellerLoading || seller === null) return <LoadingGate />;

  if (seller.status === "approved") return children;

  if (seller.status === "pending" || seller.status === "under_review") {
    return <GateCard icon={Clock} title={t("gate.sellerPendingTitle")} desc={t("gate.sellerPendingDesc")} />;
  }

  if (seller.status === "suspended") {
    return <GateCard icon={XCircle} title={t("gate.sellerSuspendedTitle")} desc={t("gate.sellerSuspendedDesc")} />;
  }

  const isRejected = seller.status === "rejected";

  // ── Multi-step seller onboarding ──

  const STEPS = [
    { label: "ร้านค้า", icon: Store },
    { label: "ข้อมูลส่วนตัว", icon: User },
    { label: "ยืนยันตัวตน", icon: ShieldCheck },
    { label: "เอกสาร", icon: FileCheck },
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
          firstName: sellerFirstName.trim(),
          lastName: sellerLastName.trim(),
          phone: sellerPhone.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "สมัครไม่สำเร็จ กรุณาลองใหม่");
      }
      setApplySuccess(true);
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
          <p className="text-sm font-medium text-amber-800">สถานะ: รอการอนุมัติ</p>
          <p className="mt-1 text-xs text-amber-600">คุณจะได้รับการแจ้งเตือนเมื่อบัญชีได้รับการอนุมัติ</p>
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
      title={isRejected ? t("gate.sellerRejectedTitle") : "สมัครเป็นพ่อค้า"}
      desc={isRejected ? t("gate.sellerRejectedDesc") : "กรอกข้อมูลด้านล่างเพื่อสมัครเป็นพ่อค้าบน Velnox"}
    >
      {isRejected && seller.rejectionReason && (
        <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
          {t("gate.sellerRejectedReason", { reason: seller.rejectionReason })}
        </p>
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
        {/* Step 0: Shop info */}
        {onboardingStep === 0 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <Store className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ข้อมูลร้านค้า</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shop-name" className="text-xs font-medium text-slate-500">ชื่อร้านค้า</Label>
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
          </div>
        )}

        {/* Step 1: Personal info */}
        {onboardingStep === 1 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <User className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ข้อมูลส่วนตัว</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="first-name" className="text-xs font-medium text-slate-500">ชื่อ</Label>
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
                <Label htmlFor="last-name" className="text-xs font-medium text-slate-500">นามสกุล</Label>
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
              <Label htmlFor="phone" className="text-xs font-medium text-slate-500">เบอร์โทรศัพท์</Label>
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

        {/* Step 2: Identity verification (mock) */}
        {onboardingStep === 2 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <ShieldCheck className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">ข้อมูลยืนยันตัวตน</span>
            </div>
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-700">การยืนยันตัวตนอยู่ในโหมดทดสอบ — ไม่ต้องกรอกข้อมูลจริง</p>
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
          </div>
        )}

        {/* Step 3: Document upload (mock) */}
        {onboardingStep === 3 && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2">
              <Camera className="size-4 text-[#10B981]" />
              <span className="text-xs font-semibold text-slate-700">เอกสารยืนยันตัวตน</span>
            </div>
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-700">ระบบยืนยันตัวตนจำลอง — เลือกไฟล์ทดสอบได้เลย</p>
            </div>
            {[
              { label: "รูปบัตรประชาชนด้านหน้า", file: sellerIdFront, set: setSellerIdFront },
              { label: "รูปบัตรประชาชนด้านหลัง", file: sellerIdBack, set: setSellerIdBack },
              { label: "รูปถ่ายยืนยันตัวตน / Selfie", file: sellerSelfie, set: setSellerSelfie },
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
              ส่งคำขอสมัครร้านค้า
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
