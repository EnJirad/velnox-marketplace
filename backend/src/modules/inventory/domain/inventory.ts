export type StockMovementType = "inbound" | "outbound";
export type StockMovementReason =
  | "restock"
  | "reservation"
  | "release"
  | "commit"
  | "return"
  | "adjustment";

export interface StockMovement {
  readonly productId: string;
  readonly variantId?: string;
  readonly type: StockMovementType;
  readonly reason: StockMovementReason;
  readonly quantity: number;
  readonly referenceId?: string;
  readonly notes?: string;
}

export interface InventoryLevel {
  readonly productId: string;
  readonly variantId?: string;
  readonly quantity: number;
  readonly reserved: number;
  readonly available: number;
}
