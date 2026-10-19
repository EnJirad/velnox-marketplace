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
 * Wholesale (store accounts + `product_selling_units.is_wholesale`) — PARKED
 * 2026-10-19.
 *
 * The MVP is now explicitly **BUY + SELL + CONTROL**, and B2B / wholesale is out
 * of scope. Wholesale is a property of a selling unit, NOT the selling unit
 * itself: a set or a pack is core commerce and **stays on** — the piece / set /
 * pack choice, its own price, and the single base-unit stock authority are all
 * untouched. What is parked is only the second buyer track:
 *
 *   * the store-account application and its VelCenter review queue,
 *   * the product-page "wholesale tier" callout and the `ขายส่ง` badges,
 *   * every selling unit a seller marked `is_wholesale` (hidden and unbuyable,
 *     so a wholesale price can never leak to a retail customer).
 *
 * Nothing is deleted: the table, the column, the routes, the page, the queue and
 * the tests stay in the repository, and flipping BOTH this flag and
 * `backend/lib/features.ts#WHOLESALE_ENABLED` restores the track unchanged.
 */
export const WHOLESALE_ENABLED = false;

/**
 * Customer Memory: behavioural event collection (`/events/track`), guest →
 * account identity merge and the "Commerce that remembers you" copy. When off,
 * `useTracking()` is a no-op and nothing is sent to the API.
 */
export const CUSTOMER_MEMORY_ENABLED = false;
