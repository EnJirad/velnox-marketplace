import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { apiBaseUrl } from "@velnox/shared/lib/sites";
import {
  ArrowLeft,
  Camera,
  Loader2,
  MapPin,
  Phone,
  Save,
  Store,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const API_BASE = apiBaseUrl;

interface ShopProfile {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  cover: string | null;
  rating: number | null;
  productCount: number;
  category: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    subdistrict: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string;
  };
  phone: string | null;
  email: string | null;
}

async function uploadToR2(
  file: File,
  purpose: "shop-logo" | "shop-cover",
  shopId: string,
): Promise<string | null> {
  const presignRes = await fetch(`${API_BASE}/upload/presign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      purpose,
      shopId,
    }),
  });
  if (!presignRes.ok) return null;
  const { data } = await presignRes.json();

  const putRes = await fetch(data.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) return null;

  await fetch(`${API_BASE}/upload/confirm`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectKey: data.objectKey, purpose, entityId: shopId }),
  });

  return data.publicUrl || null;
}

export default function SellerProfile() {
  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // Editable fields
  const [shopName, setShopName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState({
    line1: "",
    line2: "",
    subdistrict: "",
    district: "",
    city: "",
    state: "",
    postalCode: "",
    country: "TH",
  });

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/seller/profile`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load profile");
      const { data } = await res.json();
      const s = data.shops?.[0] as ShopProfile | undefined;
      if (!s) return;
      setShop(s);
      setShopName(s.name);
      setDescription(s.description || "");
      setCategory(s.category || "");
      setPhone(s.phone || "");
      setAddress({
        line1: s.address?.line1 || "",
        line2: s.address?.line2 || "",
        subdistrict: s.address?.subdistrict || "",
        district: s.address?.district || "",
        city: s.address?.city || "",
        state: s.address?.state || "",
        postalCode: s.address?.postalCode || "",
        country: s.address?.country || "TH",
      });
    } catch (err) {
      console.error(err);
      toast.error("ไม่สามารถโหลดข้อมูลร้านค้าได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    if (!shopName.trim()) {
      toast.error("กรุณากรอกชื่อร้านค้า");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/seller/shop`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: shopName.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          phone: phone.trim() || null,
          address: {
            line1: address.line1.trim() || null,
            line2: address.line2.trim() || null,
            subdistrict: address.subdistrict.trim() || null,
            district: address.district.trim() || null,
            city: address.city.trim() || null,
            state: address.state.trim() || null,
            postalCode: address.postalCode.trim() || null,
            country: address.country || "TH",
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const { data } = await res.json();
      setShop((prev) => (prev ? { ...prev, ...data } : prev));
      toast.success("บันทึกข้อมูลร้านค้าสำเร็จ");
    } catch {
      toast.error("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !shop) return;
    setUploadingLogo(true);
    try {
      const url = await uploadToR2(file, "shop-logo", shop.id);
      if (url) {
        setShop((prev) => (prev ? { ...prev, logo: url } : prev));
        toast.success("อัปโหลดโลโก้ร้านสำเร็จ");
      }
    } catch {
      toast.error("ไม่สามารถอัปโหลดรูปได้");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !shop) return;
    setUploadingCover(true);
    try {
      const url = await uploadToR2(file, "shop-cover", shop.id);
      if (url) {
        setShop((prev) => (prev ? { ...prev, cover: url } : prev));
        toast.success("อัปโหลดรูปหน้าร้านสำเร็จ");
      }
    } catch {
      toast.error("ไม่สามารถอัปโหลดรูปได้");
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <Loader2 className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
        <Link
          to="/seller/shop"
          className="flex size-8 items-center justify-center rounded-full hover:bg-slate-100"
        >
          <ArrowLeft className="size-4 text-slate-600" />
        </Link>
        <h1 className="text-sm font-bold text-slate-900">โปรไฟล์ร้านค้า</h1>
      </div>

      {/* Cover */}
      <div className="relative">
        <div
          className="h-40 bg-cover bg-center"
          style={{
            backgroundImage: shop?.cover
              ? `url(${shop.cover})`
              : undefined,
            backgroundColor: "#E2E8F0",
          }}
        />
        <button
          onClick={() => coverInputRef.current?.click()}
          className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full bg-white/90 shadow-md"
          disabled={uploadingCover}
        >
          {uploadingCover ? (
            <Loader2 className="size-4 animate-spin text-slate-600" />
          ) : (
            <Camera className="size-4 text-slate-600" />
          )}
        </button>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUpload}
        />
        {/* Logo */}
        <div className="absolute -bottom-8 left-4">
          <button
            onClick={() => logoInputRef.current?.click()}
            className="relative"
            disabled={uploadingLogo}
          >
            <div className="size-16 rounded-2xl border-4 border-white bg-white shadow-md overflow-hidden">
              {shop?.logo ? (
                <img
                  src={shop.logo}
                  alt={shop?.name}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center bg-slate-100">
                  <Store className="size-6 text-slate-400" />
                </div>
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-[#10B981] text-white">
              {uploadingLogo ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Camera className="size-3" />
              )}
            </div>
          </button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoUpload}
          />
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 pt-12">
        <h2 className="text-lg font-bold text-slate-900">{shop?.name}</h2>
        {shop?.slug && (
          <p className="text-xs text-slate-400">@{shop.slug}</p>
        )}

        {/* Edit form */}
        <div className="mt-6 space-y-5">
          {/* Basic info */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <Store className="size-4 text-[#10B981]" />
              <span className="text-sm font-semibold text-slate-900">ข้อมูลร้านค้า</span>
            </div>
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-slate-500">ชื่อร้านค้า</Label>
                <Input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="h-10 rounded-[10px] border-slate-200"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-slate-500">คำอธิบาย</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#10B981]/20"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-slate-500">ประเภทร้านค้า</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="เช่น อิเล็กทรอนิกส์, แฟชั่น"
                  className="h-10 rounded-[10px] border-slate-200"
                />
              </div>
            </div>
          </section>

          {/* Contact */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <Phone className="size-4 text-[#10B981]" />
              <span className="text-sm font-semibold text-slate-900">ช่องทางติดต่อ</span>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium text-slate-500">เบอร์โทรศัพท์ร้าน</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="081-234-5678"
                className="h-10 rounded-[10px] border-slate-200"
              />
            </div>
          </section>

          {/* Address */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="size-4 text-[#10B981]" />
              <span className="text-sm font-semibold text-slate-900">ที่อยู่ร้านค้า</span>
            </div>
            <div className="space-y-3">
              <Input
                value={address.line1}
                onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
                placeholder="บ้านเลขที่ / ถนน"
                className="h-10 rounded-[10px] border-slate-200"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={address.subdistrict}
                  onChange={(e) => setAddress((a) => ({ ...a, subdistrict: e.target.value }))}
                  placeholder="ตำบล/แขวง"
                  className="h-10 rounded-[10px] border-slate-200"
                />
                <Input
                  value={address.district}
                  onChange={(e) => setAddress((a) => ({ ...a, district: e.target.value }))}
                  placeholder="อำเภอ/เขต"
                  className="h-10 rounded-[10px] border-slate-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={address.city}
                  onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                  placeholder="จังหวัด"
                  className="h-10 rounded-[10px] border-slate-200"
                />
                <Input
                  value={address.postalCode}
                  onChange={(e) => setAddress((a) => ({ ...a, postalCode: e.target.value }))}
                  placeholder="รหัสไปรษณีย์"
                  className="h-10 rounded-[10px] border-slate-200"
                />
              </div>
            </div>
          </section>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800 h-11 rounded-[10px]"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            บันทึกข้อมูลร้านค้า
          </Button>
        </div>
      </div>
    </div>
  );
}
