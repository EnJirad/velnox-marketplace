/**
 * Profile — Seller hub.
 * 
 * Combines: shop identity editing, verification status, 3% fee card,
 * seller settings, chat link, logout, and help — all in one tab.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Badge } from "@velnox/shared/components/ui/badge";
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { VBadge, VerificationStatusLabel } from "@velnox/shared/components/VBadge";
import { type VerificationStatus } from "@velnox/shared/lib/commerce";
import { apiBaseUrl, SITE_URLS } from "@velnox/shared/lib/sites";
import { formatBaht } from "@velnox/shared/lib/commerce";
import { compressImage } from "@velnox/shared/lib/image-optimize";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  Store, Camera, Save, Loader2, MapPin, Phone, Mail, ShieldCheck,
  LogOut, MessageCircle, ChevronRight, BadgePercent, FileText,
  Package, TrendingUp, HelpCircle, Settings2, UserCircle,
  ArrowUpRight, CheckCircle2, Clock, AlertTriangle, Ban,
  Pen, ImagePlus, Bell, Globe, DollarSign, ShoppingCart,
} from "lucide-react";

const API_BASE = apiBaseUrl;

interface ShopProfile {
  id: string; name: string; slug: string; description: string | null;
  logo: string | null; cover: string | null; rating: number | null;
  productCount: number; category: string | null; status: string;
  commissionRate: number;
  address: { line1: string | null; line2: string | null; subdistrict: string | null;
    district: string | null; city: string | null; state: string | null;
    postalCode: string | null; country: string; };
  phone: string | null; email: string | null;
  shipping: { fee: number | null; freeShippingThreshold: number | null; };
}

interface SellerInfo {
  id: string; status: string; verificationStatus: string;
  verifiedAt: string | null; createdAt: string;
}

type FormData = {
  name: string; description: string; category: string; phone: string;
  line1: string; subdistrict: string; district: string;
  city: string; postalCode: string;
};

async function uploadToR2(file: File, purpose: "shop-logo" | "shop-cover", shopId: string): Promise<string> {
  const uploadFile = await compressImage(file, purpose === "shop-logo" ? "avatar" : "cover", {
    maxBytes: purpose === "shop-logo" ? 200_000 : 500_000, quality: purpose === "shop-logo" ? 0.85 : 0.80,
  });
  const presignRes = await fetch(`${API_BASE}/upload/presign`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: uploadFile.name, contentType: uploadFile.type, purpose, shopId }),
  });
  if (!presignRes.ok) throw new Error("Failed to get upload URL");
  const { data } = await presignRes.json();
  const putRes = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": uploadFile.type }, body: uploadFile });
  if (!putRes.ok) throw new Error("Upload failed");
  const confirmRes = await fetch(`${API_BASE}/upload/confirm`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKey: data.objectKey }),
  });
  if (!confirmRes.ok) throw new Error("Failed to save upload");
  const { data: saved } = await confirmRes.json();
  return saved?.url || data.publicUrl;
}

const VERIFICATION_META: Record<string, { label: string; tone: string; icon: typeof ShieldCheck }> = {
  verified: { label: "ยืนยันตัวตนแล้ว", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", icon: CheckCircle2 },
  pending: { label: "รอตรวจสอบ", tone: "bg-amber-50 text-amber-700 ring-amber-600/20", icon: Clock },
  rejected: { label: "ไม่ผ่านการยืนยัน", tone: "bg-red-50 text-red-700 ring-red-600/20", icon: AlertTriangle },
  suspended: { label: "ถูกระงับ", tone: "bg-slate-100 text-slate-600 ring-slate-600/10", icon: Ban },
  unverified: { label: "ยังไม่ได้ยืนยัน", tone: "bg-slate-50 text-slate-500 ring-slate-600/10", icon: ShieldCheck },
};

export default function SellerProfile() {
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [seller, setSeller] = useState<SellerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [activeTab, setActiveTab] = useState<"shop" | "settings" | "policies">("shop");
  const [notifications, setNotifications] = useState({
    notifyNewOrder: true,
    notifyReturn: true,
    notifyPromotion: false,
  });

  const [form, setForm] = useState<FormData>({
    name: "", description: "", category: "", phone: "",
    line1: "", subdistrict: "", district: "", city: "", postalCode: "",
  });

  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/seller/profile`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load profile");
      const { data } = await res.json();
      const s = data.shops?.[0] as ShopProfile | undefined;
      setSeller(data.seller as SellerInfo);
      if (s) {
        setShop(s);
        setForm({
          name: s.name, description: s.description || "", category: s.category || "", phone: s.phone || "",
          line1: s.address?.line1 || "", subdistrict: s.address?.subdistrict || "",
          district: s.address?.district || "", city: s.address?.city || "", postalCode: s.address?.postalCode || "",
        });
      }
    } catch { toast.error("ไม่สามารถโหลดข้อมูลร้านค้าได้"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("กรุณากรอกชื่อร้านค้า"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/seller/shop`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || null,
          category: form.category.trim() || null, phone: form.phone.trim() || null,
          address: { line1: form.line1.trim() || null, subdistrict: form.subdistrict.trim() || null,
            district: form.district.trim() || null, city: form.city.trim() || null,
            postalCode: form.postalCode.trim() || null, country: "TH" },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success("บันทึกข้อมูลร้านค้าสำเร็จ");
      load();
    } catch { toast.error("ไม่สามารถบันทึกข้อมูลได้"); }
    finally { setSaving(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !shop) return;
    setUploadingLogo(true);
    try { const url = await uploadToR2(file, "shop-logo", shop.id); setShop((prev) => prev ? { ...prev, logo: url } : prev); toast.success("อัปโหลดโลโก้สำเร็จ"); }
    catch { toast.error("อัปโหลดไม่สำเร็จ"); }
    finally { setUploadingLogo(false); if (logoRef.current) logoRef.current.value = ""; }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !shop) return;
    setUploadingCover(true);
    try { const url = await uploadToR2(file, "shop-cover", shop.id); setShop((prev) => prev ? { ...prev, cover: url } : prev); toast.success("อัปโหลดรูปหน้าร้านสำเร็จ"); }
    catch { toast.error("อัปโหลดไม่สำเร็จ"); }
    finally { setUploadingCover(false); if (coverRef.current) coverRef.current.value = ""; }
  };

  const handleSignOut = async () => { await signOut(); window.location.href = "/auth"; };

  if (loading) return (
    <div className="min-h-screen bg-[#F8FAFC]"><AppHeader />
      <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-slate-400" /></div>
    </div>
  );

  const vMeta = VERIFICATION_META[seller?.verificationStatus ?? "unverified"] ?? VERIFICATION_META.unverified;
  const VIcon = vMeta.icon;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {/* ── Tab switcher ─────────────────────────────────────── */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 mb-6 overflow-x-auto">
          {([["shop", "ร้านค้า"], ["settings", "ตั้งค่า"], ["policies", "นโยบาย"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === key ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >{label}</button>
          ))}
        </div>

        {/* ── TAB: Shop Info ──────────────────────────────────── */}
        {activeTab === "shop" && (
          <div className="space-y-5">
            {/* Cover + Identity header */}
            <div className="relative">
              <div className="h-36 sm:h-44 rounded-2xl bg-cover bg-center overflow-hidden"
                style={{ backgroundImage: shop?.cover ? `url(${shop.cover})` : undefined, backgroundColor: "#E2E8F0" }}
              />
              <button onClick={() => coverRef.current?.click()} disabled={uploadingCover}
                className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full bg-white/90 shadow-md hover:bg-white"
              >{uploadingCover ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4 text-slate-600" />}</button>
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />

              <div className="absolute -bottom-8 left-4 sm:left-6">
                <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo} className="relative group">
                  <div className="size-16 sm:size-20 rounded-2xl border-4 border-white bg-white shadow-md overflow-hidden">
                    {shop?.logo ? <img src={shop.logo} alt="" className="size-full object-cover" />
                      : <div className="flex size-full items-center justify-center bg-slate-100"><Store className="size-7 text-slate-400" /></div>}
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                    {uploadingLogo ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
                  </div>
                </button>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </div>
            </div>

            <div className="pt-8 sm:pt-10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">{shop?.name ?? "—"}</h1>
                  {shop?.slug && <p className="text-xs text-slate-400 mt-0.5">/{shop.slug}</p>}
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${vMeta.tone}`}>
                  <VIcon className="size-3.5" />{vMeta.label}
                </span>
              </div>

              {shop?.description && <p className="mt-2 text-sm text-slate-500 leading-6">{shop.description}</p>}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: Package, label: "สินค้า", value: String(shop?.productCount ?? 0) },
                { icon: BadgePercent, label: "ค่าธรรมเนียม", value: `${shop?.commissionRate ?? 3}%` },
                { icon: TrendingUp, label: "เรตติ้ง", value: shop?.rating != null ? `${shop.rating}/5` : "—" },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 text-center">
                  <span className="flex items-center justify-center size-8 mx-auto rounded-lg bg-emerald-50 text-emerald-600 mb-1">
                    <Icon className="size-4" />
                  </span>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-sm font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            {/* Shop editor form */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                <Pen className="size-4 text-emerald-500" /> แก้ไขข้อมูลร้านค้า
              </h2>
              <div className="space-y-3">
                <div className="grid gap-1.5"><Label className="text-xs text-slate-500">ชื่อร้านค้า</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-10 rounded-md border-slate-200" /></div>
                <div className="grid gap-1.5"><Label className="text-xs text-slate-500">คำอธิบาย</Label>
                  <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3}
                    className="rounded-md border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20" /></div>
                <div className="grid gap-1.5"><Label className="text-xs text-slate-500">เบอร์โทร</Label>
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="081-234-5678" className="h-10 rounded-md border-slate-200" /></div>
                <div className="grid gap-1.5"><Label className="text-xs text-slate-500">ที่อยู่</Label>
                  <Input value={form.line1} onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))} placeholder="บ้านเลขที่ / ถนน" className="h-10 rounded-md border-slate-200" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={form.subdistrict} onChange={(e) => setForm((f) => ({ ...f, subdistrict: e.target.value }))} placeholder="ตำบล" className="h-10 rounded-md border-slate-200" />
                    <Input value={form.district} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))} placeholder="อำเภอ" className="h-10 rounded-md border-slate-200" />
                    <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} placeholder="จังหวัด" className="h-10 rounded-md border-slate-200" />
                    <Input value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} placeholder="รหัสไปรษณีย์" className="h-10 rounded-md border-slate-200" />
                  </div>
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full h-11 gap-1.5 bg-slate-900 text-white hover:bg-slate-800 rounded-md">
                  {saving && <Loader2 className="size-4 animate-spin" />}<Save className="size-4" />บันทึก
                </Button>
              </div>
            </section>

            {/* Menu links */}
            <div className="space-y-1 rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {[
                { icon: MessageCircle, label: "แชทกับลูกค้า", desc: "ตอบคำถามจากลูกค้า", to: "/seller/chat", chevron: true },
                { icon: FileText, label: "ดูหน้าร้านค้า", desc: "VelShop: SUPER GADGET ZENE", to: `${SITE_URLS.velshop}/shops/${shop?.slug ?? shop?.id}`, external: true },
              ].map(({ icon: Icon, label, desc, to, external, chevron }) => (
                external ? (
                  <a key={label} href={to} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600"><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{label}</p><p className="text-xs text-slate-400 truncate">{desc}</p></div>
                    <ArrowUpRight className="size-4 text-slate-400 shrink-0" />
                  </a>
                ) : (
                  <Link key={label} to={to} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600"><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{label}</p><p className="text-xs text-slate-400">{desc}</p></div>
                    <ChevronRight className="size-4 text-slate-400 shrink-0" />
                  </Link>
                )
              ))}
            </div>
          </div>
        )}

        {/* ── TAB: Settings ────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="space-y-3">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                <UserCircle className="size-4 text-emerald-500" /> บัญชีผู้ใช้
              </h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2"><span className="text-sm text-slate-600">ชื่อ</span><span className="text-sm font-medium text-slate-900">{user?.name ?? "—"}</span></div>
                <div className="flex items-center justify-between py-2"><span className="text-sm text-slate-600">อีเมล</span><span className="text-sm font-medium text-slate-900">{user?.email ?? "—"}</span></div>
                <div className="flex items-center justify-between py-2"><span className="text-sm text-slate-600">บทบาท</span><Badge variant="secondary" className="text-xs">{seller?.status ?? "seller"}</Badge></div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                <ShieldCheck className="size-4 text-emerald-500" /> การยืนยันตัวตน
              </h2>
              <div className="flex items-center gap-3 mb-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${vMeta.tone}`}>
                  <VIcon className="size-3.5" />{vMeta.label}
                </span>
                {seller?.verifiedAt && <span className="text-xs text-slate-400">ยืนยันเมื่อ {new Date(seller.verifiedAt).toLocaleDateString("th-TH")}</span>}
              </div>
              {seller?.verificationStatus === "unverified" && (
                <p className="text-xs text-slate-500">กรุณายืนยันตัวตนร้านค้าเพื่อรับเครื่องหมาย V และเพิ่มความน่าเชื่อถือให้ร้านค้าของคุณ</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                <Settings2 className="size-4 text-emerald-500" /> การตั้งค่าร้านค้า
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <Globe className="size-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">ภาษาหน้าร้าน</p>
                      <p className="text-xs text-slate-400">ไทย (ค่าเริ่มต้น)</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-slate-300" />
                </div>
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <DollarSign className="size-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">สกุลเงิน</p>
                      <p className="text-xs text-slate-400">THB (บาท)</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-slate-300" />
                </div>
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="size-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">ค่าจัดส่งเริ่มต้น</p>
                      <p className="text-xs text-slate-400">{shop?.shipping?.fee != null ? `${formatBaht(shop.shipping.fee)}` : "ยังไม่ระบุ"}</p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-slate-300" />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                <Bell className="size-4 text-emerald-500" /> การแจ้งเตือน
              </h2>
              <div className="space-y-3">
                {[
                  { key: "notifyNewOrder" as const, label: "ออเดอร์ใหม่", desc: "เมื่อมีลูกค้าสั่งซื้อสินค้า" },
                  { key: "notifyReturn" as const, label: "การตีกลับ", desc: "เมื่อมีสินค้าถูกตีกลับ" },
                  { key: "notifyPromotion" as const, label: "โปรโมชั่น", desc: "ข่าวสารและโปรโมชั่นจาก Velnox" },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{label}</p>
                      <p className="text-xs text-slate-400">{desc}</p>
                    </div>
                    <div role="switch" aria-checked={notifications[key]} tabIndex={0}
                      className={`relative inline-flex h-6 w-10 cursor-pointer items-center rounded-full transition-colors ${notifications[key] ? 'bg-emerald-500' : 'bg-slate-200'}`}
                      onClick={() => setNotifications(prev => ({ ...prev, [key]: !prev[key] }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setNotifications(prev => ({ ...prev, [key]: !prev[key] })); }}}>
                      <span className={`inline-block size-4 transform rounded-full bg-white transition-transform shadow-sm ${notifications[key] ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Help */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                <HelpCircle className="size-4 text-emerald-500" /> คำแนะนำ
              </h2>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-start gap-2"><span className="mt-1 size-1.5 rounded-full bg-emerald-400 shrink-0" /> ขายสินค้าจริงคุณภาพดี — ลูกค้าจะกลับมาซื้อซ้ำ</li>
                <li className="flex items-start gap-2"><span className="mt-1 size-1.5 rounded-full bg-emerald-400 shrink-0" /> ตอบแชทไว — ยิ่งตอบไว โอกาสปิดการขายยิ่งสูง</li>
                <li className="flex items-start gap-2"><span className="mt-1 size-1.5 rounded-full bg-emerald-400 shrink-0" /> จัดส่งตรงเวลา — การจัดส่งตรงต่อเวลาช่วยเพิ่มความน่าเชื่อถือ</li>
                <li className="flex items-start gap-2"><span className="mt-1 size-1.5 rounded-full bg-emerald-400 shrink-0" /> ตั้งเป้าหมายยอดขาย — ใช้หน้าเป้าหมายเพื่อติดตามความคืบหน้า</li>
              </ul>
            </section>

            {/* Logout */}
            <div className="pt-4">
              <Button variant="outline" onClick={handleSignOut}
                className="w-full h-11 gap-2 border-red-200 text-red-600 hover:bg-red-50 rounded-md">
                <LogOut className="size-4" />ออกจากระบบ
              </Button>
            </div>
          </div>
        )}

        {/* ── TAB: Policies ───────────────────────────────────── */}
        {activeTab === "policies" && (
          <div className="space-y-4">
            {/* 3% Fee card */}
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
                  <BadgePercent className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">ค่าธรรมเนียม Velnox</h2>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    Velnox เก็บค่าธรรมเนียม <strong className="text-emerald-700">3% ต่อชิ้น</strong> จากยอดขายที่สำเร็จ 
                    — ยิ่งขายมาก ยิ่งคุ้ม
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    ตัวอย่าง: ขายสินค้าราคา ฿100 → ค่าธรรมเนียม ฿3 · ขาย 1,000 ชิ้น = จ่าย ฿3,000
                  </p>
                </div>
              </div>
            </section>

            {/* Return policy card */}
            <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                  <AlertTriangle className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">นโยบายการตีกลับ</h2>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    Velnox ครอบคลุมค่าส่งตีกลับไม่เกิน <strong className="text-amber-700">10% ของยอดขาย</strong>
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    <li className="flex items-start gap-1.5"><span className="mt-1 size-1 rounded-full bg-amber-400 shrink-0" /> สมมติยอดขาย 1,000 ชิ้น — คุ้มครองสูงสุด 100 ชิ้น</li>
                    <li className="flex items-start gap-1.5"><span className="mt-1 size-1 rounded-full bg-amber-400 shrink-0" /> หากตีกลับเกิน 10% — ส่วนต่างหักจากยอดรายได้สุทธิของร้าน</li>
                    <li className="flex items-start gap-1.5"><span className="mt-1 size-1 rounded-full bg-amber-400 shrink-0" /> คำนวณเป็นรายวัน รายสัปดาห์ และรายเดือน ดูได้ที่แถบรายได้</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Verification info */}
            <section className="rounded-2xl border border-sky-200 bg-sky-50/40 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">เครื่องหมาย V</h2>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">
                    ร้านค้าที่ผ่านการยืนยันตัวตนจะได้รับเครื่องหมาย <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600"><ShieldCheck className="size-3.5" /> V</span> 
                    {' '}แสดงบนสินค้าทุกรายการ เพิ่มความเชื่อมั่นให้ลูกค้า
                  </p>
                  <div className="mt-3">
                    <VerificationStatusLabel status={(seller?.verificationStatus ?? "unverified") as VerificationStatus} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
