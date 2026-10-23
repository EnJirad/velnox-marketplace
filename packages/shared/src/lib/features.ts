/**
 * Velnox — feature switches for PARKED modules (MVP restructure, 2026-10-14).
 *
 * The owner re-scoped Velnox to a marketplace that works first as an ordinary
 * buy-and-sell site (retail) and adds a second buyer track for community /
 * village shops ordering wholesale by the piece or by the pack. VelRepeat
 * (recurring / prepaid repeat commerce) and Customer Memory (behavioural
 * personalization — the "จำแทนคุณ" promise) are **parked, not deleted**:
 * every table, route, page, component and test stays in the repository so they
 * can be switched back on later without a rewrite.
 *
 * Flipping a flag to `true` here restores that module's storefront surface.
 * The backend has its own switch (`backend/lib/features.ts`) and it **fails
 * closed**, so flipping only this one shows a UI whose API calls answer 404 —
 * change both together.
 */
export const VELREPEAT_ENABLED = false;

/**
 * Customer Memory: behavioural event collection (`/events/track`), guest →
 * account identity merge and the "Commerce that remembers you" copy. When off,
 * `useTracking()` is a no-op and nothing is sent to the API.
 */
export const CUSTOMER_MEMORY_ENABLED = false;
