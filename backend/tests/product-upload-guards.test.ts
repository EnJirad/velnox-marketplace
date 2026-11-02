/**
 * Guards for the seller draft-upload path and the stored-image size check.
 *
 * Both are security/data-integrity boundaries: the draft-upload intent mints a
 * presigned R2 PUT from client-supplied path parts, and save-image must not
 * accept an object larger than the documented limit.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SUBFOLDER,
  isSafePathSegment,
  sanitiseSegment,
  sanitiseSubfolder,
} from "../lib/upload-paths.js";

const repoRoot = join(import.meta.dir, "..", "..");
const productsRoute = readFileSync(join(repoRoot, "backend/routes/products.ts"), "utf8");

describe("draft upload path segments", () => {
  test("a sanitised subfolder can never escape the seller prefix", () => {
    for (const evil of ["../products", "../../x", "/etc", "..", ".", "a/../../b", "a//b/../c"]) {
      const safe = sanitiseSubfolder(evil);
      expect(safe).not.toContain("..");
      expect(safe.startsWith("/")).toBe(false);
      expect(safe.split("/").every(isSafePathSegment)).toBe(true);
    }
    expect(sanitiseSubfolder("../products")).toBe(DEFAULT_SUBFOLDER);
    expect(sanitiseSubfolder("a/../../b")).toBe(DEFAULT_SUBFOLDER);
  });

  test("the subfolders the seller UI sends survive", () => {
    expect(sanitiseSubfolder("preview")).toBe("preview");
    expect(sanitiseSubfolder("details")).toBe("details");
    expect(sanitiseSubfolder("options/0/1")).toBe("options/0/1");
  });

  test("too many segments or odd characters fall back", () => {
    expect(sanitiseSubfolder("a/b/c/d")).toBe(DEFAULT_SUBFOLDER);
    expect(sanitiseSubfolder("pre view")).toBe(DEFAULT_SUBFOLDER);
    expect(sanitiseSubfolder("preview\u0000")).toBe(DEFAULT_SUBFOLDER);
  });

  test("draft ids are a single safe segment or a generated fallback", () => {
    expect(sanitiseSegment("8f14e45f-ceea-467f-a8e0-1a1b2c3d4e5f", "fb")).toBe(
      "8f14e45f-ceea-467f-a8e0-1a1b2c3d4e5f",
    );
    expect(sanitiseSegment("../../x", "fallback")).toBe("fallback");
    expect(sanitiseSegment("", "fallback")).toBe("fallback");
    expect(sanitiseSegment(undefined, "fallback")).toBe("fallback");
  });

  test("segment predicate rejects dots and separators", () => {
    expect(isSafePathSegment("abc-DEF_123")).toBe(true);
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("a/b")).toBe(false);
    expect(isSafePathSegment("a b")).toBe(false);
  });
});

describe("products route wiring", () => {
  test("the draft-upload intent cannot interpolate raw client path parts", () => {
    expect(productsRoute).toContain("sanitiseSegment(draftId");
    expect(productsRoute).toContain("sanitiseSubfolder(subfolder)");
    expect(productsRoute).not.toContain("const safeSubfolder = subfolder || \"preview\";");
    expect(productsRoute).toContain("draft-uploads/${seller.id}/${safeDraftId}/${safeSubfolder}/");
  });

  test("save-image rejects an oversized stored object", () => {
    expect(productsRoute).toContain("storedSize = head.ContentLength;");
    expect(productsRoute).toContain("isUploadTooLarge(storedSize)");
    expect(productsRoute).toContain('code: "FILE_TOO_LARGE"');
  });
});
