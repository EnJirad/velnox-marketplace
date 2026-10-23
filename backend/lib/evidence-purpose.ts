/**
 * Evidence object key → purpose — the ONE parser every reader shares.
 *
 * The R2 evidence key is minted by `POST /api/seller/evidence/upload-intent`
 * (and by the legacy product-evidence presign) as:
 *
 *     verification/evidence/{ownerSegment}/{purpose}_{timestamp}.{ext}
 *
 * so the purpose is recoverable from the filename. Three call sites used to
 * recover it with `filename.split("_")[0]` — which is wrong for every purpose
 * that contains an underscore (`id_card`, `id_card_back`, `selfie_id`,
 * `product_photo`, `supplier_doc`, …): `id_card_back_1758000000000.jpg`
 * parses to `"id"`, not `"id_card_back"`.
 *
 * The consequence was not cosmetic. `POST /api/seller/apply` derives the
 * submitted identity purposes this way and rejects the application when the
 * three required purposes are absent, so an applicant who had uploaded all
 * three documents (media rows present, R2 objects present) was still told
 * "Missing required identity documents: id_card, id_card_back, selfie_id".
 *
 * Parse the purpose as everything before the trailing `_{timestamp}` instead.
 */
export function evidencePurposeFromKey(key: string): string {
  const filename = String(key || "").split("/").pop() || "";
  const stem = filename.replace(/\.[^.]*$/, "");
  const stamped = stem.match(/^(.+)_\d{6,}$/);
  if (stamped?.[1]) return stamped[1];
  // No timestamp suffix (unexpected/legacy key) — the leading segment is the
  // best available answer, matching the previous fallback.
  const first = stem.split("_")[0] ?? "";
  return first || "other";
}
