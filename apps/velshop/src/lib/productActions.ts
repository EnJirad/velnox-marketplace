/**
 * Product purchase actions and the semantic button styling shared by the
 * Product Detail trigger buttons and the Selection Sheet confirm buttons.
 *
 * Keeping the class strings in one place guarantees the trigger and the sheet
 * always render the same color for the same action.
 */

export type ProductAction = "buy" | "cart";

/** How the selection sheet was opened. */
export type SelectionEntryMode = "options" | ProductAction;

/** Semantic action → Button className (used by triggers + sheet confirm). */
export const ACTION_BUTTON_CLASSES: Record<ProductAction, string> = {
  /** Buy Now — dark / primary */
  buy: "bg-slate-900 text-white hover:bg-slate-800",
  /** Add to Cart — Velnox green */
  cart: "bg-[#10B981] text-white hover:bg-emerald-600",
};