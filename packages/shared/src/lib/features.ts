/**
 * Velnox — feature switches for PARKED modules.
 *
 * The owner re-scoped Velnox to a marketplace that works first as an ordinary
 * buy-and-sell site (retail) and adds a second buyer track for community /
 * village shops ordering wholesale by the piece or by the pack. Customer Memory
 * (behavioural personalization — the "จำแทนคุณ" promise) is **parked, not
 * deleted**: every table, route, component and test stays in the repository so
 * it can be switched back on later without a rewrite.
 *
 * Flipping this flag to `true` restores that module's storefront surface. The
 * backend has its own switch (`backend/lib/features.ts`) and it **fails closed**,
 * so flipping only this one shows a UI whose API calls answer 404 — change both
 * together.
 */
export const CUSTOMER_MEMORY_ENABLED = false;
