/**
 * Canonical structured review-reason vocabulary — ONE verification system.
 *
 * VelCenter reviewers must pick a structured code (never free text alone) when
 * requesting a correction or rejecting a seller verification. The backend
 * validates the same list (`backend/routes/verification.ts`), and
 * `backend/tests/seller-verification.test.ts` asserts the two stay in sync.
 *
 * Every code here is applicant-visible. Internal reviewer notes travel in the
 * separate `note` field and are not shown to the applicant.
 */

export type VerificationReviewReasonCode =
  | "id_card_unclear"
  | "id_card_incomplete"
  | "selfie_unclear"
  | "selfie_missing_id"
  | "document_expired"
  | "applicant_mismatch"
  | "store_incomplete"
  | "contact_incomplete"
  | "address_incomplete"
  | "duplicate_account"
  | "policy_violation"
  | "other";

/**
 * Reviewer checklist groups. These mirror the existing seller-application
 * policy: identity readability/completeness, applicant match and application
 * completeness. They never replace the reviewer's final decision.
 */
export const REVIEW_CHECKLIST = {
  identity: [
    "idCardReadable",
    "idCardComplete",
    "applicantMatches",
    "selfieShowsApplicant",
    "selfieShowsIdCard",
    "imageQuality",
  ],
  application: ["applicantComplete", "storeComplete", "contactComplete", "addressComplete"],
} as const;

/** Section a reason code belongs to, used to group the picker in VelCenter. */
export const REVIEW_REASON_GROUP: Record<VerificationReviewReasonCode, "identity" | "application" | "eligibility"> = {
  id_card_unclear: "identity",
  id_card_incomplete: "identity",
  selfie_unclear: "identity",
  selfie_missing_id: "identity",
  document_expired: "identity",
  applicant_mismatch: "identity",
  store_incomplete: "application",
  contact_incomplete: "application",
  address_incomplete: "application",
  duplicate_account: "eligibility",
  policy_violation: "eligibility",
  other: "eligibility",
};

/** Canonical ordered list — mirrors the backend allowlist exactly. */
export const REVIEW_REASON_CODES: VerificationReviewReasonCode[] = [
  "id_card_unclear",
  "id_card_incomplete",
  "selfie_unclear",
  "selfie_missing_id",
  "document_expired",
  "applicant_mismatch",
  "store_incomplete",
  "contact_incomplete",
  "address_incomplete",
  "duplicate_account",
  "policy_violation",
  "other",
];

/**
 * i18n key for a reason code. All three locales must define every key
 * (guarded by `bun run i18n:check`).
 */
export function reasonCodeKey(code: VerificationReviewReasonCode): string {
  return `reviewReason.${code}`;
}
