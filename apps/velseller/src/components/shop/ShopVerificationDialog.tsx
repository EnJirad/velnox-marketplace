/**
 * Shop identity verification wizard — one dialog, two steps.
 *
 * Extracted from `MyShop.tsx`. Behaviour is unchanged where the backend decides
 * it: evidence is uploaded to R2 through `EvidenceUploader`, confirmed with
 * `POST /api/seller/evidence/confirm`, hydrated from `GET /api/seller/evidence`,
 * and submitted with `POST /api/seller/verification` (which rejects an empty
 * evidence list and verifies that every key belongs to the caller).
 *
 * Removed on purpose: step 1 used to collect first/last name, phone and address
 * that were never sent to any endpoint. Collecting identity data the backend
 * never receives is a privacy problem and a promise the UI cannot keep, so the
 * step now lists what to prepare instead. No PII is gathered here.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { EvidenceUploader, type EvidenceFile } from "@velnox/shared/components/seller/EvidenceUploader";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";

type Step = 1 | 2;

interface ShopVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-read the seller profile after a successful submit. */
  onSubmitted: () => Promise<void> | void;
  /** Notification deep links land straight on the upload step. */
  startAtEvidence?: boolean;
}

export function ShopVerificationDialog({
  open,
  onOpenChange,
  onSubmitted,
  startAtEvidence = false,
}: ShopVerificationDialogProps) {
  const { t } = useLanguage();
  const submitSellerVerification = useAction(api.seller.submitVerification);
  const confirmEvidence = useAction(api.seller.evidenceConfirm);
  const fetchEvidence = useAction(api.seller.evidenceList);

  const [step, setStep] = useState<Step>(1);
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasUploading = files.some((f) => f.status === "uploading" || f.status === "pending");
  const hasUploaded = files.some((f) => f.status === "uploaded" && f.cdnUrl);

  useEffect(() => {
    if (!open) return;
    setStep(startAtEvidence ? 2 : 1);
    if (hydrated) return;
    let cancelled = false;
    fetchEvidence()
      .then((rows: any[]) => {
        if (cancelled) return;
        if (Array.isArray(rows) && rows.length > 0) {
          setFiles(
            rows.map((row: any) => ({
              id: `hydrated_${row.id ?? row.key}`,
              filename: String(row.key).split("/").pop() || "evidence",
              contentType: row.content_type || "image/jpeg",
              fileSize: row.size ?? 0,
              purpose: row.purpose || "other",
              status: "uploaded" as const,
              objectKey: row.key,
              cdnUrl: row.url,
              previewUrl: row.url,
            })),
          );
        }
      })
      .catch(() => {
        /* hydration is best-effort — the seller can always upload again */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, hydrated, fetchEvidence, startAtEvidence]);

  /** Persist the R2 object metadata so a refresh does not lose the document. */
  const handleUploaded = useCallback(
    async (info: {
      objectKey: string;
      cdnUrl: string;
      filename: string;
      contentType: string;
      fileSize: number;
      purpose: string;
    }) => {
      try {
        await confirmEvidence({
          objectKey: info.objectKey,
          publicUrl: info.cdnUrl,
          filename: info.filename,
          contentType: info.contentType,
          fileSize: info.fileSize,
        });
      } catch (error) {
        console.error("Evidence confirmation error:", error);
        toast.error(t("sellerDash.shop.toastFailed"));
      }
    },
    [confirmEvidence, t],
  );

  const replacePurpose = (purpose: string, next: EvidenceFile[]) => {
    setFiles((prev) => [...prev.filter((f) => f.purpose !== purpose), ...next]);
  };

  const handleSubmit = async () => {
    if (!hasUploaded) {
      toast.error(t("sellerDash.shop.verifyNoEvidence"));
      return;
    }
    setBusy(true);
    try {
      const evidenceUrls = files.filter((f) => f.status === "uploaded" && f.cdnUrl).map((f) => f.cdnUrl!);
      await submitSellerVerification({ verificationType: "identity", evidenceUrls });
      toast.success(t("verification.sellerVerificationSubmitted"));
      await onSubmitted();
      onOpenChange(false);
    } catch (error) {
      console.error("Verification submit error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-[#10B981]" aria-hidden="true" />
            {t("sellerDash.shop.verifyTitle")}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? t("sellerDash.shop.verifyStepRequirements")
              : t("sellerDash.shop.verifyStepEvidence")}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator: two steps, no numbers-in-decorations. */}
        <ol className="flex items-center gap-2 text-xs font-medium" aria-label={t("sellerDash.shop.verifyTitle")}>
          {([1, 2] as Step[]).map((value) => (
            <li
              key={value}
              className={`flex-1 rounded-full px-3 py-1.5 text-center ${
                step === value
                  ? "bg-[#ECFDF5] text-[#047857] ring-1 ring-inset ring-emerald-600/20"
                  : "bg-slate-100 text-slate-500"
              }`}
              aria-current={step === value ? "step" : undefined}
            >
              {value === 1
                ? t("sellerDash.shop.verifyStepRequirements")
                : t("sellerDash.shop.verifyStepEvidence")}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="grid gap-4 pt-1">
            <ul className="grid gap-3">
              {[
                t("sellerDash.shop.verifyReq1"),
                t("sellerDash.shop.verifyReq2"),
                t("sellerDash.shop.verifyReq3"),
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm leading-6 text-slate-600">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#10B981]" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              {t("sellerDash.shop.verifyPrivacy")}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 pt-1">
            <EvidenceUploader
              purpose="id_card"
              label={t("sellerDash.shop.verifyDocIdCard")}
              description={t("sellerDash.shop.verifyReq1")}
              files={files.filter((f) => f.purpose === "id_card")}
              onFilesChange={(next) => replacePurpose("id_card", next)}
              onUploadSuccess={handleUploaded}
              maxFiles={2}
            />
            <EvidenceUploader
              purpose="selfie_id"
              label={t("sellerDash.shop.verifyDocSelfie")}
              description={t("sellerDash.shop.verifyReq2")}
              files={files.filter((f) => f.purpose === "selfie_id")}
              onFilesChange={(next) => replacePurpose("selfie_id", next)}
              onUploadSuccess={handleUploaded}
              maxFiles={2}
            />
            <p className="text-xs leading-5 text-slate-500">{t("sellerDash.shop.verifyPrivacy")}</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 2 && (
            <Button variant="outline" className="h-11" onClick={() => setStep(1)} disabled={busy}>
              {t("sellerDash.shop.verifyBack")}
            </Button>
          )}
          {step === 1 ? (
            <Button
              className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              onClick={() => setStep(2)}
            >
              {t("sellerDash.shop.verifyNext")}
            </Button>
          ) : (
            <Button
              className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              onClick={() => void handleSubmit()}
              disabled={busy || hasUploading || !hasUploaded}
            >
              {(busy || hasUploading) && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {hasUploading
                ? t("sellerDash.shop.verifyUploading")
                : t("verification.submitForVerification")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
