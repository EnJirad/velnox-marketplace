/**
 * Rich product description — content blocks.
 *
 * WHY
 * ---
 * A product description used to be one TEXT column: the seller could write words,
 * but could not put an image between two paragraphs, and any image they uploaded
 * went into the gallery or was dropped. This module owns the SHAPE and the
 * VALIDATION of the richer structure, so the backend, the seller editor and the
 * shopfront cannot disagree about what a block is.
 *
 * ONE block shape: `{ type, ...fields }`, and the array order IS the display
 * order. Keeping it a JSON array (not a table) is deliberate: blocks belong to
 * exactly one product, they are never queried on their own, and there is no
 * second place to keep in sync. `products.description_blocks` stores it.
 *
 * IMAGE SEPARATION (the rule this file exists to enforce)
 * ------------------------------------------------------
 *   gallery — the thumbnail strip at the top. Never rendered from blocks.
 *   detail  — images that illustrate the description. These ARE block images.
 *   variant — an option's own photo. Never a block, never a gallery thumbnail.
 * A block image is a `detail` image: it is written to the same `product_images`
 * row with `image_type = 'detail'`, which is what keeps it out of the gallery
 * query (`WHERE image_type = 'gallery'`) and therefore out of the thumbnail strip.
 */
export type DescriptionBlockType = "heading" | "text" | "image" | "image_caption" | "image_text";

export interface DescriptionBlock {
  /** Stable client-side key, unique within one description. */
  id: string;
  type: DescriptionBlockType;
  /** heading / text / image_text body, or the caption of an image_caption. */
  text?: string;
  /** image / image_text / image_caption URL. */
  imageUrl?: string;
  /** image_text: image on the left, text on the right. */
  alt?: string;
}

export const DESCRIPTION_BLOCK_TYPES: DescriptionBlockType[] = [
  "heading",
  "text",
  "image",
  "image_caption",
  "image_text",
];

export const MAX_DESCRIPTION_BLOCKS = 40;
export const MAX_BLOCK_TEXT = 4000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A URL this platform can actually display: http(s) or a protocol-relative CDN URL. */
export function isDisplayableImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^(https?:\/\/|\/\/)[^\s]+$/i.test(value.trim());
}

/**
 * Validate and NORMALISE untrusted blocks.
 *
 * Returns `{ ok: true, blocks }` or `{ ok: false, reason }`. Never throws: a
 * malformed payload is a 400 with a message, not a 500. Empty and missing input
 * both mean "no rich description" and are accepted, because a product saved with
 * only plain text must keep working.
 */
export function validateDescriptionBlocks(
  input: unknown,
): { ok: true; blocks: DescriptionBlock[] } | { ok: false; reason: string } {
  if (input === undefined || input === null) return { ok: true, blocks: [] };
  if (!Array.isArray(input)) return { ok: false, reason: "descriptionBlocks must be an array" };
  if (input.length > MAX_DESCRIPTION_BLOCKS) {
    return { ok: false, reason: `A description may hold at most ${MAX_DESCRIPTION_BLOCKS} blocks` };
  }

  const blocks: DescriptionBlock[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (!isRecord(raw)) return { ok: false, reason: `Block ${i + 1} is not an object` };

    const type = raw.type;
    if (typeof type !== "string" || !DESCRIPTION_BLOCK_TYPES.includes(type as DescriptionBlockType)) {
      return { ok: false, reason: `Block ${i + 1} has an unknown type` };
    }

    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 64) : `block-${i + 1}`;
    if (seenIds.has(id)) return { ok: false, reason: `Block ${i + 1} repeats the id "${id}"` };
    seenIds.add(id);

    const block: DescriptionBlock = { id, type: type as DescriptionBlockType };

    const text = typeof raw.text === "string" ? raw.text : "";
    if (text.length > MAX_BLOCK_TEXT) {
      return { ok: false, reason: `Block ${i + 1} is longer than ${MAX_BLOCK_TEXT} characters` };
    }

    const wantsText = type === "heading" || type === "text" || type === "image_text" || type === "image_caption";
    if (wantsText && text.trim() === "") {
      return { ok: false, reason: `Block ${i + 1} (${type}) needs text` };
    }
    if (text) block.text = text;

    const wantsImage = type === "image" || type === "image_text" || type === "image_caption";
    if (wantsImage) {
      if (!isDisplayableImageUrl(raw.imageUrl)) {
        return { ok: false, reason: `Block ${i + 1} (${type}) needs a valid image URL` };
      }
      block.imageUrl = (raw.imageUrl as string).trim();
    }

    const alt = typeof raw.alt === "string" ? raw.alt.trim().slice(0, 200) : "";
    if (alt) block.alt = alt;

    blocks.push(block);
  }

  return { ok: true, blocks };
}

/** Parse what the database hands back (JSONB in Neon, but a string is tolerated). */
export function parseDescriptionBlocks(value: unknown): DescriptionBlock[] {
  if (Array.isArray(value)) {
    const parsed = validateDescriptionBlocks(value);
    return parsed.ok ? parsed.blocks : [];
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = validateDescriptionBlocks(JSON.parse(value));
      return parsed.ok ? parsed.blocks : [];
    } catch {
      return [];
    }
  }
  return [];
}
