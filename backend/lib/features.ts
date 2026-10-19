/**
 * Velnox — backend feature switches for PARKED modules (MVP restructure, 2026-10-14).
 *
 * FAIL CLOSED: a module is enabled only when its variable is exactly the string
 * `"true"`. An unset, misspelled, empty or otherwise unexpected value leaves the
 * module off, so a misconfigured environment can never expose a parked surface
 * (VelRepeat routes, its two schedulers and its boot-time table creation, or the
 * Customer Memory event endpoints).
 *
 * The frontend mirrors these in `packages/shared/src/lib/features.ts` and must be
 * flipped together — the frontend flag decides what the storefront renders, this
 * one decides what the API will accept.
 *
 * Parking is not removal: the routes, jobs, tables, migrations and tests are all
 * still in the repository, so re-enabling is one environment variable per module.
 */
export const VELREPEAT_ENABLED = process.env.VELREPEAT_ENABLED === "true";

export const CUSTOMER_MEMORY_ENABLED = process.env.CUSTOMER_MEMORY_ENABLED === "true";

/**
 * Wholesale (store accounts + `is_wholesale` selling units) — PARKED 2026-10-19.
 *
 * The MVP is BUY + SELL + CONTROL; B2B / wholesale is out of scope. Selling
 * units (set / pack) are core and are NOT gated by this flag — only the second
 * buyer track is.
 *
 * FAIL CLOSED, like the two above: only the exact string `"true"` opens it. When
 * off, the three wholesale authorities answer as if no store were ever approved
 * (`lib/store-accounts.ts`), wholesale units are never loaded, resolved or
 * counted (`lib/selling-units.ts`), the store-account routes are not mounted, and
 * the `stores.manage` code leaves the permission catalog — so a crafted request, a
 * stale cached page or a misconfigured environment can all only see the retail
 * marketplace.
 */
export const WHOLESALE_ENABLED = process.env.WHOLESALE_ENABLED === "true";
