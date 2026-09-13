/**
 * VerificationReviewDialog — Professional verification review panel for VelCenter admins.
 *
 * Provides:
 * - Subject summary (seller or product information)
 * - Evidence/document/image viewer
 * - Review checklist
 * - Approve / Reject / Suspend actions with reason
 * - Verification history
 *
 * Backend authorization is enforced server-side. This component is UI only.
 */

import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { VerificationStatusLabel } from "@velnox/shared/components/VBadge";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  ImageOff,
  Loader2,
  ShieldCheck,
  Store,
  Package,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";

/* ─── Types ────────────────────────────────────────────────────────── */

export interface VerificationReviewRow {
  id: string;
  status: string;
  verification_type?: string | null;
  evidence_urls?: string[] | null;
  evidence_notes?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  rejection_reason?: string | null;
  suspension_reason?: string | null;
  shop_name?: string | null;
  product_name?: string | null;
  product_slug?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  product_price?: string | null;
  product_status?: string | null;
}

interface VerificationReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "seller" | "product";
  row: VerificationReviewRow | null;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onSuspend: (reason: string) => void;
}

/* ─── Evidence Viewer ───────────────────────────────────────────────── */

function EvidenceViewer({ urls, notes }: { urls: string[] | null; notes: string | null }) {
  const list = Array.isArray(urls) ? urls : [];
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const handleImageError = useCallback((url: string) => {
    setFailedImages((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const isImage = (url: string) => /\.(jpg|jpeg|png|gif|webp|avif|bmp)$/i.test(url);
  const getFileName = (url: string) => {
    try {
      const path = new URL(url).pathname;
      return path.split("/").pop() ?? url;
    } catch {
      return url.split("/").pop() ?? url;
    }
  };

  // Parse evidence notes for categorization
  const noteLines = notes ? notes.split("\n").filter(Boolean) : [];
  const evidenceCounts = noteLines.reduce((acc, line) => {
    const match = line.match(/(\d+)\s*ไฟล์/);
    if (match) acc.push({ label: line.replace(/\s*\d+\s*ไฟล์/, ""), count: parseInt(match[1]) });
    return acc;
  }, [] as { label: string; count: number }[]);
  const hasSummary = evidenceCounts.length > 0;

  if (list.length === 0 && !notes) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <FileText className="mx-auto size-7 text-slate-300" />
        <p className="mt-2 text-sm text-slate-400">ไม่มีหลักฐานที่แนบ</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Evidence summary */}
      {hasSummary && (
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500">สรุปหลักฐาน</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {evidenceCounts.map((ec, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                {ec.label}: {ec.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Evidence notes */}
      {notes && !hasSummary && (
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500">หมายเหตุจากผู้ขาย</p>
          <p className="mt-1 text-sm text-slate-700">{notes}</p>
        </div>
      )}

      {/* Evidence files - image grid */}
      {list.some(isImage) && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">รูปภาพหลักฐาน ({list.filter(isImage).length})</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {list.filter(isImage).map((url) => {
              const failed = failedImages.has(url);
              return (
                <div key={url} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {failed ? (
                    <div className="flex aspect-square items-center justify-center bg-slate-50">
                      <ImageOff className="size-5 text-slate-300" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(url)}
                      className="block w-full"
                    >
                      <img
                        src={url}
                        alt="Evidence"
                        className="aspect-square w-full object-cover bg-slate-50 transition-transform group-hover:scale-105"
                        onError={() => handleImageError(url)}
                        loading="lazy"
                      />
                    </button>
                  )}
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-700"
                    aria-label="Open full size"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Evidence files - documents */}
      {list.some((u) => !isImage(u)) && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">เอกสารหลักฐาน ({list.filter((u) => !isImage(u)).length})</p>
          <div className="space-y-1.5">
            {list.filter((u) => !isImage(u)).map((url) => (
              <div key={url} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <FileText className="size-4 text-slate-400" />
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-xs font-medium text-[#10B981] hover:underline"
                  >
                    {getFileName(url)}
                  </a>
                  <p className="mt-0.5 truncate text-[10px] text-slate-400">{url}</p>
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="shrink-0 text-slate-400 hover:text-slate-600"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-colors hover:bg-white/30"
          >
            <X className="size-4" />
          </button>
          <img
            src={lightboxUrl}
            alt="Evidence full size"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Review Checklist ──────────────────────────────────────────────── */

function ReviewChecklist({
  kind,
  checked,
  onToggle,
}: {
  kind: "seller" | "product";
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const sellerItems = [
    { key: "identity", label: "ข้อมูลตัวตนตรงกับหลักฐานที่แนบ" },
    { key: "complete", label: "ข้อมูลที่จำเป็นครบถ้วน" },
    { key: "valid", label: "เอกสารดูถูกต้อง" },
    { key: "consistent", label: "ข้อมูลร้านค้าสอดคล้องกัน" },
    { key: "requirements", label: "ตรงตามเกณฑ์ที่กำหนด" },
  ];

  const productItems = [
    { key: "info", label: "ข้อมูลสินค้าครบถ้วน" },
    { key: "evidence", label: "หลักฐานที่แนบเพียงพอ" },
    { key: "match", label: "หลักฐานตรงกับข้อมูลสินค้า" },
    { key: "images", label: "รูปภาพ/หลักฐานสอดคล้องกัน" },
    { key: "rules", label: "สินค้าตรงตามกฎของ marketplace" },
  ];

  const items = kind === "seller" ? sellerItems : productItems;
  const checkedCount = items.filter((i) => checked[i.key]).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">รายการตรวจสอบ</p>
        <span className="text-[10px] text-slate-400">
          {checkedCount}/{items.length}
        </span>
      </div>
      {items.map((item) => (
        <label
          key={item.key}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-100 bg-white p-2.5 transition-colors hover:border-slate-200"
        >
          <input
            type="checkbox"
            checked={!!checked[item.key]}
            onChange={() => onToggle(item.key)}
            className="size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500/40"
          />
          <span className="text-xs text-slate-600">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

/* ─── Main Dialog ───────────────────────────────────────────────────── */

export function VerificationReviewDialog({
  open,
  onOpenChange,
  kind,
  row,
  busy,
  onApprove,
  onReject,
  onSuspend,
}: VerificationReviewDialogProps) {
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"reject" | "suspend" | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const handleToggle = (key: string) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAction = () => {
    if (!action || !reason.trim()) return;
    if (action === "reject") onReject(reason.trim());
    else onSuspend(reason.trim());
    setReason("");
    setAction(null);
  };

  const handleApproveClick = () => {
    onApprove();
    setChecklist({});
  };

  const handleClose = () => {
    onOpenChange(false);
    setReason("");
    setAction(null);
    setChecklist({});
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "seller" ? (
              <Store className="size-4 text-[#10B981]" />
            ) : (
              <Package className="size-4 text-[#10B981]" />
            )}
            {kind === "seller" ? "ตรวจสอบการยืนยันร้านค้า" : "ตรวจสอบการยืนยันสินค้า"}
          </DialogTitle>
          <DialogDescription>
            {kind === "seller"
              ? "ตรวจสอบหลักฐานและตัดสินใจเกี่ยวกับการยืนยันตัวตนของร้านค้า"
              : "ตรวจสอบหลักฐานและตัดสินใจเกี่ยวกับการยืนยันสินค้า"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 md:grid-cols-2">
          {/* LEFT: Subject Summary */}
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                ข้อมูลSubject
              </h4>
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                {kind === "seller" ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">ร้านค้า</span>
                      <span className="text-sm font-medium text-slate-900">{row.shop_name ?? "—"}</span>
                    </div>
                    {row.owner_name && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">เจ้าของ</span>
                        <span className="text-sm text-slate-700">{row.owner_name}</span>
                      </div>
                    )}
                    {row.owner_email && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">อีเมล</span>
                        <span className="text-sm text-slate-700">{row.owner_email}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">สินค้า</span>
                      <span className="text-sm font-medium text-slate-900">{row.product_name ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">ร้านค้า</span>
                      <span className="text-sm text-slate-700">{row.shop_name ?? "—"}</span>
                    </div>
                    {row.product_price && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">ราคา</span>
                        <span className="text-sm font-medium text-slate-900">฿{row.product_price}</span>
                      </div>
                    )}
                    {row.product_status && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">สถานะสินค้า</span>
                        <Badge className="rounded-full bg-slate-100 text-slate-600 text-[10px]">{row.product_status}</Badge>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                  <span className="text-xs text-slate-400">ประเภทการยืนยัน</span>
                  <span className="text-sm text-slate-700">{row.verification_type ?? "identity"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">ส่งเมื่อ</span>
                  <span className="text-sm text-slate-700">
                    {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString("th-TH") : "—"}
                  </span>
                </div>
                {row.reviewed_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">ตรวจสอบเมื่อ</span>
                    <span className="text-sm text-slate-700">
                      {new Date(row.reviewed_at).toLocaleDateString("th-TH")}
                    </span>
                  </div>
                )}
                {(row.rejection_reason || row.suspension_reason) && (
                  <div className="rounded-lg bg-red-50 p-2.5">
                    <p className="text-xs font-medium text-red-600">
                      เหตุผล: {row.rejection_reason || row.suspension_reason}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Status + V Eligibility */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                สถานะปัจจุบัน
              </h4>
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">สถานะการยืนยัน</span>
                  <VerificationStatusLabel status={row.status as any} />
                </div>
                {kind === "product" && (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className="text-xs text-slate-400">V Eligibility</span>
                    <Badge className={`rounded-full text-[10px] ${
                      row.status === "verified"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}>
                      {row.status === "verified" ? "V ACTIVE" : "V NOT ACTIVE"}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Evidence + Checklist */}
          <div className="space-y-4">
            {/* Evidence Viewer */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                หลักฐานที่แนบ
              </h4>
              <EvidenceViewer urls={row.evidence_urls ?? null} notes={row.evidence_notes ?? null} />
            </div>

            {/* Review Checklist */}
            {row.status === "pending" && (
              <ReviewChecklist kind={kind} checked={checklist} onToggle={handleToggle} />
            )}
          </div>
        </div>

        {/* Action Buttons */}
        {row.status === "pending" && (
          <DialogFooter className="flex-col gap-3 sm:flex-row">
            {action ? (
              <div className="w-full space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="review-reason">
                    เหตุผล{action === "reject" ? "การปฏิเสธ" : "การระงับ"}
                  </Label>
                  <Textarea
                    id="review-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={action === "reject"
                      ? "เช่น เอกสารไม่ชัดเจน / ไม่ตรงกับข้อมูล"
                      : "เช่น พบปัญหาด้านความปลอดภัย"}
                    className="rounded-[10px] border-slate-200"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => { setAction(null); setReason(""); }}
                    disabled={busy}
                  >
                    ยกเลิก
                  </Button>
                  <Button
                    className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
                    disabled={busy || !reason.trim()}
                    onClick={handleAction}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {action === "reject" ? "ยืนยันปฏิเสธ" : "ยืนยันระงับ"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex w-full flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
                  onClick={() => setAction("reject")}
                  disabled={busy}
                >
                  ปฏิเสธ
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 border-orange-200 text-orange-600 hover:bg-orange-50"
                  onClick={() => setAction("suspend")}
                  disabled={busy}
                >
                  ระงับ
                </Button>
                <div className="flex-1" />
                <Button
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={handleApproveClick}
                  disabled={busy}
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  <CheckCircle2 className="size-4" />
                  อนุมัติ
                </Button>
              </div>
            )}
          </DialogFooter>
        )}

        {/* For non-pending status, show close button */}
        {row.status !== "pending" && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>ปิด</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
