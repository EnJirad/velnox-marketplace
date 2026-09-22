/**
 * Seller-verification self-action guard.
 *
 * `PATCH /api/admin/verifications/seller/:verificationId` is reachable by any
 * VelCenter reviewer — `owner`, `admin` or `staff` holding `sellers.manage` —
 * and a reviewer may also own a shop. `approve` on that shop's verification is
 * the ONLY write in the backend that sets `sellers.verification_status =
 * 'verified'`, i.e. the only way to earn the green V that every buyer-facing
 * surface reads as "Velnox checked this identity". So a reviewer who is also
 * the applicant must not be able to reach it: self-dealing staff must not be
 * able to grant themselves trust.
 *
 * Scope — only `approve` is a self-action here. The other three decisions
 * (`reject`, `suspend`, `needs_correction`) can only lower the reviewer's own
 * standing, so blocking them would be a behaviour change with no security gain.
 * This mirrors the broader guard on the seller-application route
 * (`PATCH /api/admin/seller-applications/:id`, which refuses a self `approved`
 * or `rejected`) while staying specific to the decision each route offers.
 *
 * Kept pure and action-aware so the whole rule — including "the other three
 * decisions are allowed" — is testable without a database or a session.
 * See `backend/tests/verification-self-approval.test.ts`.
 */

/** The single decision that grants the V trust badge. */
const GRANTING_ACTION = "approve";

/**
 * Would `action` let `actorUserId` grant a verification for a shop they
 * themselves own?
 *
 * Ids are compared as strings. The session id (`req.user.userId`) and
 * `sellers.user_id` both arrive as UUID strings today, but coercing means a
 * change in either driver's return type can never silently disable the guard.
 *
 * An unknown owner — `seller_verifications.seller_id` has a foreign key to
 * `sellers`, so a row cannot lack one, but a null/empty `user_id` is possible —
 * is NOT treated as a match: a reviewer who cannot be shown to own the record is
 * judged like any other reviewer, which is the status quo for every legitimate
 * approval. The guard's job is to stop the reviewer we can positively identify,
 * and it fails closed on the actions it covers.
 */
export function isSelfApproval(
  action: string,
  actorUserId: string | null | undefined,
  sellerUserId: string | null | undefined,
): boolean {
  if (action !== GRANTING_ACTION) return false;
  if (!actorUserId || !sellerUserId) return false;
  return String(actorUserId) === String(sellerUserId);
}
