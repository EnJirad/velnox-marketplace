/**
 * VerificationReviewDialog — VelCenter seller-application review workspace.
 *
 * ONE verification system: SELLER / SHOP identity verification. There is no
 * product verification queue.
 *
 * The reviewer can inspect the whole application — applicant, store, address and
 * the private identity documents — without leaving the dialog.
 *
 * Security:
 *  - the identity documents come from GET /api/admin/sellers/:id/application,
 *    which authorizes the caller server-side and returns SHORT-LIVED SIGNED R2
 *    URLs. No evidence URL is ever a public bucket URL.
 *  - corrections and rejections require a structured reason code; the reviewer's
 *    identity is always taken from the authenticated session by the backend.
 *  - internal notes are stored separately from applicant-visible reasons.
 */

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
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  REVIEW_CHECKLIST,
  REVIEW_REASON_CODES,
  REVIEW_REASON_GROUP,
  type VerificationReviewReasonCode,
} from "@velnox/shared/lib/verification-reasons";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  History,
  ImageOff,
  Loader2,
  ShieldCheck,
  Store,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ─── Types ────────────────────────────────────────────────────────── */

export interface VerificationReviewRow {
  id: string;
  seller_id: string;
  status: string;
  verification_type?: string | null;
  evidence_count?: number | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  suspension_reason?: string | null;
  review_reason_code?: string | null;
  review_note?: string | null;
  shop_name?: string | null;
  shop_slug?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  seller_status?: string | null;
  verification_status?: string | null;
}

interface ReviewDocument {
  key: string;
  purpose: string;
  filename: string;
  url: string | null;
  expiresIn: number;
}

interface ReviewHistoryEntry {
  id: string;
  previous_status: string | null;
  new_status: string;
  action: string;
  reason_code: string | null;
  reason: string | null;
  note: string | null;
  created_at: string;
  reviewer_name: string | null;
}

interface ApplicationDetail {
  seller: { id: string; status: string; verificationStatus: string | null; verifiedAt: string | null; createdAt: string; updatedAt: string };
  applicant: { name: string | null; email: string | null; phone: string | null; firstName: string | null; lastName: string | null; idNumber: string | null };
  store: { name: string | null; slug: string | null; description: string | null; category: string | null; logo: string | null; cover: string | null };
  address: Record<string, string | null>;
  verification: { id: string | null; type: string | null; status: string | null; submittedAt: string | null; reviewedAt: string | null; rejectionReason: string | null; suspensionReason: string | null; reviewReasonCode: string | null; reviewNote: string | null };
  documents: ReviewDocument[];
  history: ReviewHistoryEntry[];
}

export type ReviewDecisionAction = "approve" | "reject" | "suspend" | "needs_correction";

export interface ReviewDecision {
  action: ReviewDecisionAction;
  reasonCode?: VerificationReviewReasonCode;
  reason?: string;
  note?: string;
}

interface VerificationReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: VerificationReviewRow | null;
  busy: boolean;
  onDecision: (decision: ReviewDecision) => void;
}

/* ─── Document viewer (signed, private URLs) ────────────────────────── */

function DocumentCard({ doc, label }: { doc: ReviewDocument; label: string }) {
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="truncate text-xs font-medium text-slate-700">{label}</span>
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-slate-400 hover:text-slate-600"
              aria-label="Open full size"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
        {!doc.url || failed ? (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 bg-slate-50 px-3 text-center">
            <ImageOff className="size-5 text-slate-300" />
            <p className="text-[10px] text-slate-400">{t("review.evidenceFailed")}</p>
          </div>
        ) : (
          <button type="button" onClick={() => setZoom(true)} className="block w-full">
            <img
              src={doc.url}
              alt={label}
              loading="lazy"
              onError={() => setFailed(true)}
              className="aspect-[4/3] w-full bg-slate-50 object-contain"
            />
          </button>
        )}
        <p className="truncate border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400" title={doc.filename}>
          {doc.filename}
        </p>
      </div>

      {zoom && doc.url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(false)}
        >
          <button
            type="button"
            onClick={() => setZoom(false)}
            className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-colors hover:bg-white/30"
            aria-label={t("review.close")}
          >
            <X className="size-4" />
          </button>
          <img
            src={doc.url}
            alt={label}
            className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/* ─── Main dialog ───────────────────────────────────────────────────── */

export function VerificationReviewDialog({
  open,
  onOpenChange,
  row,
  busy,
  onDecision,
}: VerificationReviewDialogProps) {
  const { t } = useLanguage();
  const fetchApplication = useAction(api.admin.sellerApplication);

  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const [decision, setDecision] = useState<ReviewDecisionAction | null>(null);
  const [reasonCode, setReasonCode] = useState<VerificationReviewReasonCode | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [note, setNote] = useState("");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const sellerId = row?.seller_id ?? null;

  // Load the application detail + signed identity documents whenever the dialog opens.
  useEffect(() => {
    if (!open || !sellerId) return;
    let alive = true;
    setDetailState("loading");
    setDetail(null);
    fetchApplication({ sellerId })
      .then((data: ApplicationDetail) => {
        if (!alive) return;
        setDetail(data);
        setDetailState("ready");
      })
      .catch((error: unknown) => {
        console.error("Application detail error:", error);
        if (alive) setDetailState("error");
      });
    return () => { alive = false; };
  }, [open, sellerId, fetchApplication]);

  // Reset all decision state when the dialog closes
  useEffect(() => {
    if (open) return;
    setDecision(null);
    setReasonCode(null);
    setReasonText("");
    setNote("");
    setChecklist({});
    setDetail(null);
    setDetailState("idle");
  }, [open]);

  const isPending = row?.status === "pending";

  const checklistGroups = useMemo(
    () => [
      { title: t("review.checklistIdentity"), keys: REVIEW_CHECKLIST.identity as readonly string[] },
      { title: t("review.checklistApplication"), keys: REVIEW_CHECKLIST.application as readonly string[] },
    ],
    [t],
  );

  const groupedReasons = useMemo(() => {
    const groups: Record<string, VerificationReviewReasonCode[]> = { identity: [], application: [], eligibility: [] };
    for (const code of REVIEW_REASON_CODES) groups[REVIEW_REASON_GROUP[code]].push(code);
    return groups;
  }, []);

  const checklistCount = Object.values(checklist).filter(Boolean).length;
  const checklistTotal = REVIEW_CHECKLIST.identity.length + REVIEW_CHECKLIST.application.length;

  const submitDecision = useCallback(() => {
    if (!decision) return;
    if (decision !== "approve") {
      if (!reasonCode) return;
      if (decision === "reject" && !reasonText.trim()) return;
    }
    onDecision({
      action: decision,
      reasonCode: reasonCode ?? undefined,
      reason: reasonText.trim() || undefined,
      note: note.trim() || undefined,
    });
    setDecision(null);
    setReasonCode(null);
    setReasonText("");
    setNote("");
  }, [decision, note, onDecision, reasonCode, reasonText]);

  if (!row) return null;

  const docLabels: Record<string, string> = {
    id_card: t("identityDoc.idFront"),
    id_card_back: t("identityDoc.idBack"),
    selfie_id: t("identityDoc.selfie"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-y-auto p-0 sm:w-full">
        <DialogHeader className="border-b border-slate-100 px-4 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Store className="size-4 shrink-0 text-[#10B981]" />
            <span className="min-w-0 flex-1 truncate">{t("review.title")}</span>
            <VerificationStatusLabel status={(row.status === "unverified" ? "unverified" : row.status) as never} />
          </DialogTitle>
          <DialogDescription className="text-xs">{t("review.desc")}</DialogDescription>
        </DialogHeader>

        {detailState === "loading" && (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-400">
            <Loader2 className="size-4 animate-spin" />
            {t("review.loadingEvidence")}
          </div>
        )}

        {detailState === "error" && (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <AlertCircle className="size-6 text-rose-400" />
            <p className="text-sm text-rose-600">{t("review.evidenceFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => sellerId && setDetailState("idle")}>
              {t("review.retry")}
            </Button>
          </div>
        )}

        {detailState === "ready" && detail && (
          <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-2">
            {/* ── LEFT: application data ── */}
            <div className="space-y-4">
              {/* Applicant */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <User className="size-3.5" /> {t("review.applicantInfo")}
                </h4>
                <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {[
                    { label: t("review.applicantInfo"), value: detail.applicant.name },
                    { label: "Email", value: detail.applicant.email },
                    { label: "Phone", value: detail.applicant.phone },
                    { label: "ID", value: detail.applicant.idNumber },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-3 px-3 py-2">
                      <dt className="shrink-0 text-xs text-slate-400">{item.label}</dt>
                      <dd className="min-w-0 flex-1 truncate text-right text-sm text-slate-700" title={item.value ?? "—"}>
                        {item.value || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* Store */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Store className="size-3.5" /> {t("review.storeInfo")}
                </h4>
                <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-start justify-between gap-3 px-3 py-2">
                    <dt className="shrink-0 text-xs text-slate-400">{t("review.storeInfo")}</dt>
                    <dd className="min-w-0 flex-1 truncate text-right text-sm font-medium text-slate-900" title={detail.store.name ?? "—"}>
                      {detail.store.name || "—"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 px-3 py-2">
                    <dt className="shrink-0 text-xs text-slate-400">Category</dt>
                    <dd className="min-w-0 flex-1 truncate text-right text-sm text-slate-700">{detail.store.category || "—"}</dd>
                  </div>
                  {detail.store.description && (
                    <div className="px-3 py-2">
                      <dt className="text-xs text-slate-400">Description</dt>
                      <dd className="mt-1 text-sm text-slate-600">{detail.store.description}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* Address */}
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("review.addressInfo")}</h4>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
                  {[
                    detail.address.line1,
                    detail.address.line2,
                    detail.address.subdistrict,
                    detail.address.district,
                    detail.address.city,
                    detail.address.state,
                    detail.address.postalCode,
                    detail.address.country,
                  ].filter(Boolean).join(", ") || "—"}
                </div>
              </section>

              {/* Submission meta */}
              <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock className="size-3.5" /> {t("review.applicationDetail")}
                  </span>
                  <span className="text-xs text-slate-600">
                    {detail.verification.submittedAt
                      ? new Date(detail.verification.submittedAt).toLocaleString()
                      : "—"}
                  </span>
                </div>
                {detail.verification.reviewReasonCode && (
                  <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                    {t(`reviewReason.${detail.verification.reviewReasonCode}`)}
                  </p>
                )}
                {detail.verification.reviewNote && (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {t("review.noteLabel")}: {detail.verification.reviewNote}
                  </p>
                )}
                {detail.verification.rejectionReason && (
                  <p className="mt-1.5 text-[11px] text-slate-500">{detail.verification.rejectionReason}</p>
                )}
              </section>

              {/* Review history */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <History className="size-3.5" /> {t("review.history")}
                </h4>
                {detail.history.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
                    {t("review.historyEmpty")}
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {detail.history.map((h) => (
                      <li key={h.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-700">
                            {/* action keys are backend-defined verbs */}
                            {t(`review.action${h.action.charAt(0).toUpperCase()}${h.action.slice(1).replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())}`)}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {new Date(h.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {h.reason_code && (
                          <p className="mt-0.5 text-[11px] text-slate-500">{t(`reviewReason.${h.reason_code}`)}</p>
                        )}
                        {h.reason && <p className="mt-0.5 text-[11px] text-slate-500">{h.reason}</p>}
                        {h.reviewer_name && (
                          <p className="mt-0.5 text-[10px] text-slate-400">— {h.reviewer_name}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            {/* ── RIGHT: evidence + checklist + decision ── */}
            <div className="space-y-4">
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <ShieldCheck className="size-3.5" /> {t("review.identityDocs")}
                </h4>
                {detail.documents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                    <FileText className="mx-auto size-6 text-slate-300" />
                    <p className="mt-2 text-xs text-slate-400">{t("review.evidenceEmpty")}</p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      {detail.documents.map((doc) => (
                        <DocumentCard
                          key={doc.key}
                          doc={doc}
                          label={docLabels[doc.purpose] ?? doc.purpose}
                        />
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-400">{t("review.signedExpiry")}</p>
                  </>
                )}
              </section>

              {isPending && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("review.checklist")}</h4>
                    <span className="text-[10px] tabular-nums text-slate-400">{checklistCount}/{checklistTotal}</span>
                  </div>
                  <div className="space-y-3">
                    {checklistGroups.map((group) => (
                      <div key={group.title}>
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
                        <div className="space-y-1.5">
                          {group.keys.map((key) => (
                            <label
                              key={key}
                              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-2.5 py-2 transition-colors hover:border-slate-200"
                            >
                              <input
                                type="checkbox"
                                checked={!!checklist[key]}
                                onChange={() => setChecklist((prev) => ({ ...prev, [key]: !prev[key] }))}
                                className="size-4 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500/40"
                              />
                              <span className="text-xs text-slate-600">{t(`review.${key}`)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">
                    {t("review.checklist")} — {t("review.decision")}
                  </p>
                </section>
              )}

              {/* Decision */}
              {isPending && (
                <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("review.decision")}</h4>

                  {!decision ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => setDecision("approve")}
                        disabled={busy}
                      >
                        <CheckCircle2 className="size-4" /> {t("review.approve")}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => setDecision("needs_correction")}
                        disabled={busy}
                      >
                        {t("review.requestCorrection")}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
                        onClick={() => setDecision("reject")}
                        disabled={busy}
                      >
                        {t("review.reject")}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-1.5 border-slate-200 text-slate-600"
                        onClick={() => setDecision("suspend")}
                        disabled={busy}
                      >
                        {t("review.suspend")}
                      </Button>
                    </div>
                  ) : decision === "approve" ? (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-600">{t("review.approve")}</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDecision(null)} disabled={busy}>
                          {t("review.close")}
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={submitDecision}
                          disabled={busy}
                        >
                          {busy && <Loader2 className="size-3.5 animate-spin" />}
                          {t("review.approve")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Structured reasons — grouped, never free text alone */}
                      <div>
                        <Label className="text-xs font-medium text-slate-500">{t("review.reasonLabel")}</Label>
                        <div className="mt-2 space-y-3">
                          {(["identity", "application", "eligibility"] as const).map((group) => (
                            <div key={group}>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                {group === "identity" ? t("review.checklistIdentity") : group === "application" ? t("review.checklistApplication") : t("review.filterAll")}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {groupedReasons[group].map((code) => (
                                  <button
                                    key={code}
                                    type="button"
                                    onClick={() => setReasonCode(code)}
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                      reasonCode === code
                                        ? "bg-[#10B981] text-white"
                                        : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:ring-slate-300"
                                    }`}
                                  >
                                    {t(`reviewReason.${code}`)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="review-reason-text" className="text-xs font-medium text-slate-500">
                          {t("review.reasonPlaceholder")}
                        </Label>
                        <Textarea
                          id="review-reason-text"
                          rows={2}
                          value={reasonText}
                          onChange={(e) => setReasonText(e.target.value)}
                          className="rounded-[10px] border-slate-200 bg-white text-sm"
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="review-note" className="text-xs font-medium text-slate-500">
                          {t("review.noteLabel")}
                        </Label>
                        <Textarea
                          id="review-note"
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={t("review.notePlaceholder")}
                          className="rounded-[10px] border-slate-200 bg-white text-sm"
                        />
                      </div>

                      <div className="flex flex-wrap items-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDecision(null)} disabled={busy}>
                          {t("review.close")}
                        </Button>
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
                          onClick={submitDecision}
                          disabled={busy || !reasonCode || (decision === "reject" && !reasonText.trim())}
                        >
                          {busy && <Loader2 className="size-3.5 animate-spin" />}
                          {decision === "reject"
                            ? t("review.confirmReject")
                            : decision === "suspend"
                              ? t("review.confirmSuspend")
                              : t("review.confirmCorrection")}
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-slate-100 px-4 py-3 sm:px-6">
          {!isPending && (
            <VerificationStatusLabel status={row.status as never} />
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("review.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
