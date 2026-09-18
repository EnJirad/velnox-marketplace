/**
 * VelCenter in-app realtime event bus.
 *
 * The Center page owns the ONE WebSocket connection to the backend and fans
 * events out to the tabs that need to refetch. Tabs subscribe here instead of
 * opening their own socket, so VelCenter keeps a single realtime system: the
 * event says "this data changed", and the tab re-reads from the API (the event
 * payload is never used as data).
 */

export type CenterRealtimeEvent =
  | "audit" // a new audit_logs row may exist
  | "products" // product moderation queue changed
  | "sellers" // seller / verification queue changed
  | "orders" // order list changed
  | "staff"; // an employee account was created or updated

type Listener = () => void;

const listeners: Record<CenterRealtimeEvent, Set<Listener>> = {
  audit: new Set(),
  products: new Set(),
  sellers: new Set(),
  orders: new Set(),
  staff: new Set(),
};

/** Called by the Center page's WebSocket handler after a realtime event arrives. */
export function emitCenterEvent(event: CenterRealtimeEvent): void {
  listeners[event].forEach((listener) => listener());
}

/**
 * Subscribe to a VelCenter realtime event.
 * Returns an unsubscribe function so callers can clean up in a useEffect.
 */
export function onCenterEvent(event: CenterRealtimeEvent, listener: Listener): () => void {
  listeners[event].add(listener);
  return () => {
    listeners[event].delete(listener);
  };
}
