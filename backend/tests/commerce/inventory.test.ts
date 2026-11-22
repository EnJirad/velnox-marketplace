import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InventoryService } from "../../src/modules/inventory/services/inventory-service.ts";
import { InventoryRepository } from "../../src/modules/inventory/repository/inventory-repository.ts";
import type { DbQueryable } from "../../../database/src/types.ts";
import { ConflictError, ValidationError } from "../../src/core/errors/app-error.ts";

describe("Commerce Core — Inventory Domain", () => {
  it("atomically reserves stock via guarded conditional update", async () => {
    let executedSql = "";
    let executedParams: any[] = [];

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        executedSql = sql.trim();
        executedParams = params ?? [];
        if (sql.includes("UPDATE inventory")) {
          return { rows: [{ id: "inv_001" }] };
        }
        return { rows: [] };
      },
    };

    await InventoryRepository.reserveStock(mockDb, "prod_001", 3);
    assert.ok(executedSql.includes("UPDATE inventory"));
    assert.ok(executedSql.includes("reserved = reserved + $1"));
    assert.ok(executedSql.includes("quantity - reserved >= $1"));
    assert.equal(executedParams[0], 3);
    assert.equal(executedParams[1], "prod_001");
  });

  it("throws ConflictError (INSUFFICIENT_STOCK) when stock cannot cover requested quantity", async () => {
    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("UPDATE inventory")) {
          // Zero rows matched conditional WHERE quantity - reserved >= quantity
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      () => InventoryRepository.reserveStock(mockDb, "prod_out_of_stock", 5),
      (err: any) => err instanceof ConflictError && err.code === "INSUFFICIENT_STOCK",
    );
  });

  it("rejects invalid reservation quantities", async () => {
    const mockDb: DbQueryable = { async query() { return { rows: [] }; } };

    await assert.rejects(
      () => InventoryService.reserveBatch(mockDb, [{ productId: "p1", quantity: 0 }]),
      ValidationError,
    );

    await assert.rejects(
      () => InventoryService.reserveBatch(mockDb, [{ productId: "p1", quantity: 1000 }]),
      (err: any) => err instanceof ValidationError && err.message.includes("exceeds limit of 999"),
    );
  });
});
