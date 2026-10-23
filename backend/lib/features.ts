/**
 * Velnox — backend feature switches for PARKED modules.
 *
 * FAIL CLOSED: a module is enabled only when its variable is exactly the string
 * `"true"`. An unset, misspelled, empty or otherwise unexpected value leaves the
 * module off, so a misconfigured environment can never expose a parked surface
 * (the Customer Memory event endpoints).
 *
 * The frontend mirrors these in `packages/shared/src/lib/features.ts` and must be
 * flipped together — the frontend flag decides what the storefront renders, this
 * one decides what the API will accept.
 */
export const CUSTOMER_MEMORY_ENABLED = process.env.CUSTOMER_MEMORY_ENABLED === "true";
