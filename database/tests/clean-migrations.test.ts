import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLEAN_MIGRATIONS_DIR = join(__dirname, "..", "clean-migrations");
const WORKER_MIGRATIONS_DIR = join(__dirname, "..", "..", "workers", "api", "migrations");

describe("Clean Schema Migration Verification Suite", () => {
  it("maintains 100% byte-for-byte parity between clean-migrations and worker migrations", () => {
    const cleanFiles = readdirSync(CLEAN_MIGRATIONS_DIR).sort();
    const workerFiles = readdirSync(WORKER_MIGRATIONS_DIR).sort();

    assert.deepEqual(cleanFiles, workerFiles, "Migration filenames must match exactly");
    assert.ok(cleanFiles.includes("0005_realtime_chat.sql"), "0005_realtime_chat.sql must exist");

    for (const file of cleanFiles) {
      const cleanContent = readFileSync(join(CLEAN_MIGRATIONS_DIR, file), "utf8");
      const workerContent = readFileSync(join(WORKER_MIGRATIONS_DIR, file), "utf8");
      assert.equal(
        cleanContent,
        workerContent,
        `File ${file} must have identical content in clean-migrations and worker migrations`,
      );
    }
  });

  it("verifies that all referenced primary keys across Clean Migrations are UUID", () => {
    const files = readdirSync(CLEAN_MIGRATIONS_DIR).sort();
    const tablePrimaryKeys: Record<string, { column: string; type: string }> = {};

    for (const file of files) {
      const sql = readFileSync(join(CLEAN_MIGRATIONS_DIR, file), "utf8");
      // Match CREATE TABLE [IF NOT EXISTS] <name> ( ... )
      const tableMatches = sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)\s*\(([\s\S]*?)\);/gi);

      for (const match of tableMatches) {
        const tableName = match[1].toLowerCase();
        const body = match[2];

        // Look for "id UUID PRIMARY KEY" or "id <type> PRIMARY KEY"
        const pkMatch = body.match(/([a-z_]+)\s+(UUID|TEXT|BIGINT|INT)\s+PRIMARY KEY/i);
        if (pkMatch) {
          tablePrimaryKeys[tableName] = {
            column: pkMatch[1].toLowerCase(),
            type: pkMatch[2].toUpperCase(),
          };
        }
      }
    }

    // Verify key tables all use UUID primary keys
    assert.equal(tablePrimaryKeys["users"]?.type, "UUID", "users.id must be UUID");
    assert.equal(tablePrimaryKeys["sellers"]?.type, "UUID", "sellers.id must be UUID");
    assert.equal(tablePrimaryKeys["shops"]?.type, "UUID", "shops.id must be UUID");
    assert.equal(tablePrimaryKeys["orders"]?.type, "UUID", "orders.id must be UUID");
    assert.equal(tablePrimaryKeys["conversations"]?.type, "UUID", "conversations.id must be UUID");
    assert.equal(tablePrimaryKeys["chat_messages"]?.type, "UUID", "chat_messages.id must be UUID");
    assert.equal(tablePrimaryKeys["notifications"]?.type, "UUID", "notifications.id must be UUID");
    assert.equal(tablePrimaryKeys["fcm_tokens"]?.type, "UUID", "fcm_tokens.id must be UUID");
  });

  it("enforces foreign key type compatibility (prevents SQLSTATE 42804 TEXT vs UUID mismatch)", () => {
    const files = readdirSync(CLEAN_MIGRATIONS_DIR).sort();
    const uuidTables = ["users", "sellers", "shops", "orders", "categories", "products", "conversations"];

    for (const file of files) {
      const sql = readFileSync(join(CLEAN_MIGRATIONS_DIR, file), "utf8");

      for (const targetTable of uuidTables) {
        // Regex to find any column typed as TEXT that references a UUID target table:
        // e.g. "customer_id TEXT REFERENCES users(id)"
        const textFkPattern = new RegExp(
          `([a-z_]+)\\s+TEXT\\s+(?:NOT NULL\\s+)?REFERENCES\\s+${targetTable}\\s*\\(`,
          "gi",
        );
        const matches = [...sql.matchAll(textFkPattern)];

        if (matches.length > 0) {
          const offendingCols = matches.map((m) => m[1]).join(", ");
          assert.fail(
            `Incompatible type in ${file}: Column(s) [${offendingCols}] are declared as TEXT referencing UUID table '${targetTable}'. This causes SQLSTATE 42804.`,
          );
        }
      }
    }
  });

  it("verifies 0005_realtime_chat.sql explicitly uses UUID foreign keys and contains self-healing migration safety", () => {
    const sql = readFileSync(join(CLEAN_MIGRATIONS_DIR, "0005_realtime_chat.sql"), "utf8");

    // Foreign keys in conversations
    assert.match(sql, /customer_id\s+UUID\s+REFERENCES\s+users\(id\)/i);
    assert.match(sql, /seller_id\s+UUID\s+REFERENCES\s+sellers\(id\)/i);
    assert.match(sql, /shop_id\s+UUID\s+REFERENCES\s+shops\(id\)/i);
    assert.match(sql, /order_id\s+UUID\s+REFERENCES\s+orders\(id\)/i);
    assert.match(sql, /assigned_to\s+UUID\s+REFERENCES\s+users\(id\)/i);

    // Foreign keys in conversation_participants
    assert.match(sql, /conversation_id\s+UUID\s+NOT NULL\s+REFERENCES\s+conversations\(id\)/i);
    assert.match(sql, /user_id\s+UUID\s+NOT NULL\s+REFERENCES\s+users\(id\)/i);

    // Foreign keys in chat_messages
    assert.match(sql, /conversation_id\s+UUID\s+NOT NULL\s+REFERENCES\s+conversations\(id\)/i);
    assert.match(sql, /sender_id\s+UUID\s+REFERENCES\s+users\(id\)/i);

    // Foreign keys in notifications
    assert.match(sql, /user_id\s+UUID\s+NOT NULL\s+REFERENCES\s+users\(id\)/i);

    // Foreign keys in fcm_tokens
    assert.match(sql, /user_id\s+UUID\s+NOT NULL\s+REFERENCES\s+users\(id\)/i);

    // Contains self-healing block for existing text columns
    assert.match(sql, /ALTER TABLE conversations ALTER COLUMN customer_id TYPE UUID USING customer_id::uuid/i);
    assert.match(sql, /ALTER TABLE conversation_participants ALTER COLUMN user_id TYPE UUID USING user_id::uuid/i);
    assert.match(sql, /ALTER TABLE chat_messages ALTER COLUMN sender_id TYPE UUID USING sender_id::uuid/i);
  });
});
