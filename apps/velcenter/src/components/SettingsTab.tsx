import React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Coins,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Package,
  Save,
  Store,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "@velnox/shared/lib/i18n/config";

export interface SettingsSectionItem {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface SettingsFormState {
  readonly shopName: string;
  readonly tagline: string;
  readonly phone: string;
  readonly announcement: string;
  readonly address: string;
}

export interface PermissionCatalogItem {
  readonly code: string;
  readonly label: string;
  readonly description: string;
}

export interface SettingsTabProps {
  readonly settingsError: string | null;
  readonly onLoadSettings: () => void;
  readonly settingsSection: string;
  readonly onSelectSection: (sectionId: string) => void;
  readonly form: SettingsFormState;
  readonly onFormChange: React.Dispatch<React.SetStateAction<SettingsFormState>>;
  readonly onSaveSettings: (e: React.FormEvent) => void;
  readonly savingSettings: boolean;
  readonly settings: any;
  readonly approvalMode: string;
  readonly onApprovalModeChange: (mode: string) => void;
  readonly savingApproval: boolean;
  readonly settingsMeta: any;
  readonly isOwner: boolean;
  readonly permissionCatalog: readonly PermissionCatalogItem[];
  readonly sections: readonly SettingsSectionItem[];
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settingsError,
  onLoadSettings,
  settingsSection,
  onSelectSection,
  form,
  onFormChange,
  onSaveSettings,
  savingSettings,
  settings,
  approvalMode,
  onApprovalModeChange,
  savingApproval,
  settingsMeta,
  isOwner,
  permissionCatalog,
  sections,
}) => {
  return (
    <div className="space-y-6">
      {settingsError && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="size-4 shrink-0" />
            โหลดการตั้งค่าไม่สำเร็จ: {settingsError}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 rounded-md"
            onClick={onLoadSettings}
          >
            ลองใหม่
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        {/* Navigation Sidebar */}
        <nav aria-label="หมวดการตั้งค่า" className="lg:sticky lg:top-24 lg:self-start">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:flex lg:flex-col lg:gap-1">
            {sections.map((section) => {
              const Icon = section.icon;
              const active = settingsSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelectSection(section.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                    active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0">{section.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Section Content */}
        <div className="min-w-0 space-y-5">
          {/* Company identity */}
          {settingsSection === "company" && (
            <Card className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Store className="size-4 text-brand" />
                  ข้อมูลบริษัท / แพลตฟอร์ม
                </CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Identity ของ Velnox Marketplace ที่แสดงบน velshop — บันทึกแล้วมีผลทันที
                  และทุกการเปลี่ยนแปลงถูกบันทึกใน Audit Logs
                </p>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSaveSettings} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="settings-name">ชื่อแพลตฟอร์ม / ร้านค้า</Label>
                    <Input
                      id="settings-name"
                      value={form.shopName}
                      onChange={(e) => onFormChange((f) => ({ ...f, shopName: e.target.value }))}
                      placeholder="เช่น Velnox Marketplace"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="settings-tagline">คำโปรย / tagline</Label>
                    <Input
                      id="settings-tagline"
                      value={form.tagline}
                      onChange={(e) => onFormChange((f) => ({ ...f, tagline: e.target.value }))}
                      placeholder="ซื้อขายของจริง · ปลีกและส่ง ในที่เดียว"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="settings-phone">เบอร์โทรติดต่อ</Label>
                      <Input
                        id="settings-phone"
                        value={form.phone}
                        onChange={(e) => onFormChange((f) => ({ ...f, phone: e.target.value }))}
                        placeholder="081-234-5678"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-announcement">ประกาศหน้าร้านค้า (ShopDetail)</Label>
                      <Input
                        id="settings-announcement"
                        value={form.announcement}
                        onChange={(e) =>
                          onFormChange((f) => ({ ...f, announcement: e.target.value }))
                        }
                        placeholder="เช่น สินค้าใหม่เข้าคลังแล้ว!"
                      />
                      <p className="text-2xs text-slate-400">
                        ประกาศนี้แสดงในหน้าร้านค้าแต่ละร้านเท่านั้น — แบนเนอร์หน้าแรกอยู่ที่แท็บ การตลาด
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="settings-address">ที่อยู่บริษัท / ที่อยู่ร้าน</Label>
                    <Textarea
                      id="settings-address"
                      value={form.address}
                      onChange={(e) => onFormChange((f) => ({ ...f, address: e.target.value }))}
                      placeholder="ที่อยู่สำหรับรับสินค้า / นัดรับ"
                      rows={2}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-fit gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                    disabled={savingSettings || settings === null}
                  >
                    {savingSettings ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    บันทึกการตั้งค่า
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Marketplace behaviour */}
          {settingsSection === "marketplace" && (
            <Card className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="size-4 text-brand" />
                  ตลาด & การอนุมัติสินค้า
                </CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  ควบคุมว่าสินค้าที่ผู้ขายส่งเข้าตลาดต้องผ่านการอนุมัติหรือไม่
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300">
                    <input
                      type="radio"
                      name="approval-mode"
                      value="manual"
                      checked={approvalMode === "manual"}
                      onChange={() => onApprovalModeChange("manual")}
                      disabled={savingApproval}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-900">อนุมัติด้วยมือ</span>
                      <p className="text-xs text-slate-500">
                        สินค้าทุกชิ้นต้องได้รับการตรวจสอบและอนุมัติจากผู้ดูแลก่อนแสดงบน VelShop
                      </p>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300">
                    <input
                      type="radio"
                      name="approval-mode"
                      value="auto"
                      checked={approvalMode === "auto"}
                      onChange={() => onApprovalModeChange("auto")}
                      disabled={savingApproval}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-900">อนุมัติอัตโนมัติ</span>
                      <p className="text-xs text-slate-500">
                        สินค้าจะได้รับการอนุมัติและแสดงบน VelShop ทันทีหลังผ่านการตรวจสอบข้อมูล
                      </p>
                    </div>
                  </label>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                  ระบบยืนยันตัวตนของ Velnox เป็นแบบเดียว: การยืนยันตัวตนของผู้ขาย/ร้านค้า
                  {settingsMeta?.moderation?.productVerificationEnabled === false
                    ? " — ไม่มีระบบยืนยันสินค้าแยกรายชิ้น ป้าย V จึงมาจากสถานะการยืนยันของผู้ขายเท่านั้น"
                    : ""}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Seller commission */}
          {settingsSection === "commission" && (
            <Card className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="size-4 text-brand" />
                  ค่าธรรมเนียมผู้ขาย (Seller & Commission)
                </CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  นโยบายการเงินที่ engine คำนวณรายได้ของผู้ขายใช้จริง — แสดงแบบอ่านอย่างเดียว
                  เพื่อไม่ให้มีแหล่งความจริงซ้อนกัน
                </p>
              </CardHeader>
              <CardContent>
                {settingsMeta?.commission ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs text-slate-400">ค่าธรรมเนียมผู้ขาย</p>
                        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                          {((settingsMeta.commission.sellerRate ?? 0) * 100).toFixed(1)}%
                        </p>
                        <p className="mt-0.5 text-2xs text-slate-400">หักจากยอดขายแต่ละรายการ</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs text-slate-400">ความคุ้มครองการคืนสินค้า</p>
                        <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                          {((settingsMeta.commission.returnCoverage ?? 0) * 100).toFixed(0)}%
                        </p>
                        <p className="mt-0.5 text-2xs text-slate-400">ของยอดขาย ครอบคลุมด้วยค่าธรรมเนียม</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs text-slate-400">สกุลเงิน</p>
                        <p className="mt-1 text-2xl font-bold text-slate-900">
                          {settingsMeta.commission.currency ?? "THB"}
                        </p>
                        <p className="mt-0.5 text-2xs text-slate-400">สกุลเงินที่ระบบใช้คำนวณ</p>
                      </div>
                    </div>
                    <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      ค่าธรรมเนียมถูกกำหนดในระดับแพลตฟอร์ม (โค้ด/คอนฟิกของผู้ให้บริการ)
                      จึงแก้จากหน้านี้ไม่ได้ — ป้องกันไม่ให้ยอดเงินของผู้ขายผิดพลาดจากการตั้งค่าโดยไม่ตั้งใจ
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">กำลังโหลดนโยบายค่าธรรมเนียม...</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Localization */}
          {settingsSection === "localization" && (
            <Card className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="size-4 text-brand" />
                  ภาษา & ท้องถิ่น
                </CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  ภาษาที่แพลตฟอร์มรองรับ (แหล่งความจริงเดียว: shared i18n config)
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <div
                      key={lang.code}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{lang.label}</p>
                        <p className="font-mono text-xs uppercase text-slate-400">{lang.code}</p>
                      </div>
                      {lang.code === DEFAULT_LANGUAGE && (
                        <Badge className="shrink-0 gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
                          <BadgeCheck className="size-3" />
                          ค่าเริ่มต้น
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-400">
                  ภาษาถูกเก็บเป็นคีย์ในฐานข้อมูล (categories.names, platform_settings) —
                  เพิ่มภาษาใหม่ต้องมี locale file ใน shared i18n
                </p>
              </CardContent>
            </Card>
          )}

          {/* Media */}
          {settingsSection === "media" && (
            <Card className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImageIcon className="size-4 text-brand" />
                  ไฟล์ & สื่อ (Media)
                </CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  ข้อจำกัดการอัปโหลดที่ backend บังคับใช้จริง (Cloudflare R2)
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-400">ขนาดไฟล์สูงสุด</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                      {settingsMeta?.media?.maxUploadBytes
                        ? `${Math.round(settingsMeta.media.maxUploadBytes / (1024 * 1024))} MB`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-400">ประเภทไฟล์ที่อนุญาต</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(settingsMeta?.media?.allowedTypes ?? []).map((type: string) => (
                        <Badge
                          key={type}
                          className="rounded-full bg-slate-100 text-2xs text-slate-600 ring-1 ring-inset ring-slate-600/10"
                        >
                          {type.replace("image/", "")}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-xs leading-5 text-slate-400">
                  ไฟล์ถูกเก็บแบบ private บน R2 — หลักฐานการยืนยันตัวตนเข้าถึงได้เฉพาะผู้ตรวจสอบผ่าน signed URL อายุสั้น
                </p>
              </CardContent>
            </Card>
          )}

          {/* Access / permissions */}
          {settingsSection === "access" && (
            <Card className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="size-4 text-brand" />
                  สิทธิ์การเข้าถึง (Permissions)
                </CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  แคตตาล็อกสิทธิ์ที่ระบบรู้จัก — การมอบสิทธิ์ทำได้ที่แท็บ “ผู้ใช้ & ลูกค้า” (เจ้าของบริษัทเท่านั้น)
                </p>
              </CardHeader>
              <CardContent>
                {isOwner ? (
                  permissionCatalog.length === 0 ? (
                    <p className="text-sm text-slate-400">กำลังโหลดรายการสิทธิ์...</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {permissionCatalog.map((perm) => (
                        <li
                          key={perm.code}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                        >
                          <p className="text-sm font-medium text-slate-900">{perm.label}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{perm.description}</p>
                          <p className="mt-1 font-mono text-2xs text-slate-300">{perm.code}</p>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                    การจัดการสิทธิ์พนักงานเป็นสิทธิ์ของเจ้าของบริษัทเท่านั้น
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;
