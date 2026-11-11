/**
 * Rich product description — editor AND renderer, shared by VelSeller and VelShop.
 *
 * The block SHAPE and the VALIDATION live in `backend/lib/description-blocks.ts`
 * (the backend validates what it stores; this file mirrors the same types so the
 * client can render and compose without a second definition drifting).
 *
 * Block types, in the order a seller builds them:
 *   heading       — a section title
 *   text          — a paragraph
 *   image         — a full-width image
 *   image_caption — a small image with a caption under it
 *   image_text    — image on the left, text on the right (stacks on mobile)
 *
 * IMAGE SEPARATION: a block image is a DETAIL image. It is stored against the
 * product with `image_type = 'detail'`, which is exactly the query the gallery
 * excludes (`WHERE image_type = 'gallery'`) — so a description image can never
 * appear as a gallery thumbnail.
 */
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Heading2,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";

export interface DescriptionBlock {
  id: string;
  type: "heading" | "text" | "image" | "image_caption" | "image_text";
  text?: string;
  imageUrl?: string;
  alt?: string;
}

export const BLOCK_TYPE_LABELS: Record<DescriptionBlock["type"], string> = {
  heading: "หัวข้อ",
  text: "ข้อความ",
  image: "รูปภาพ",
  image_caption: "รูปพร้อมคำบรรยาย",
  image_text: "รูป + ข้อความ",
};

export const BLOCK_TYPES: DescriptionBlock["type"][] = [
  "heading",
  "text",
  "image",
  "image_caption",
  "image_text",
];

const TYPE_ICONS: Record<DescriptionBlock["type"], typeof Type> = {
  heading: Heading2,
  text: Type,
  image: ImagePlus,
  image_caption: Images,
  image_text: Images,
};

const WANTS_TEXT: Record<DescriptionBlock["type"], boolean> = {
  heading: true,
  text: true,
  image: false,
  image_caption: true,
  image_text: true,
};

const WANTS_IMAGE: Record<DescriptionBlock["type"], boolean> = {
  heading: false,
  text: false,
  image: true,
  image_caption: true,
  image_text: true,
};

let seq = 0;
export function newBlock(type: DescriptionBlock["type"]): DescriptionBlock {
  seq += 1;
  return { id: `blk-${Date.now().toString(36)}-${seq}`, type };
}

export function isDisplayableImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^(https?:\/\/|\/\/)[^\s]+$/i.test(value.trim());
}

/** A block is worth saving when every field its type needs has a value. */
export function blockIsComplete(block: DescriptionBlock): boolean {
  if (WANTS_TEXT[block.type] && !(block.text ?? "").trim()) return false;
  if (WANTS_IMAGE[block.type] && !isDisplayableImageUrl(block.imageUrl)) return false;
  return true;
}

/* ─────────────────────────────── RENDERER ─────────────────────────────── */

/**
 * The description as the buyer sees it: blocks in order, then the plain text the
 * seller also wrote (kept — it is what search and the meta description use).
 */
export function ProductDescriptionContent({
  blocks,
  fallbackText,
  labels,
}: {
  blocks: DescriptionBlock[];
  fallbackText?: string | null;
  labels: { imageAlt: (n: number) => string; noImage: string };
}) {
  const shown = blocks.filter(blockIsComplete);
  const plain = (fallbackText ?? "").trim();

  if (shown.length === 0 && plain === "") return null;

  return (
    <div className="space-y-4">
      {shown.map((block, i) => {
        if (block.type === "heading") {
          return (
            <h4 key={block.id} className="text-[15px] font-bold text-slate-900">
              {block.text}
            </h4>
          );
        }
        if (block.type === "text") {
          return (
            <p key={block.id} className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {block.text}
            </p>
          );
        }
        if (block.type === "image") {
          return (
            <figure key={block.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <img
                src={block.imageUrl}
                alt={block.alt || labels.imageAlt(i + 1)}
                className="w-full object-contain"
                loading="lazy"
                decoding="async"
              />
            </figure>
          );
        }
        if (block.type === "image_caption") {
          return (
            <figure key={block.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <img
                src={block.imageUrl}
                alt={block.alt || labels.imageAlt(i + 1)}
                className="w-full object-contain"
                loading="lazy"
                decoding="async"
              />
              {block.text && (
                <figcaption className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                  {block.text}
                </figcaption>
              )}
            </figure>
          );
        }
        // image_text — side by side on desktop, stacked on a phone
        return (
          <div
            key={block.id}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"
          >
            <img
              src={block.imageUrl}
              alt={block.alt || labels.imageAlt(i + 1)}
              className="size-full max-h-56 w-full shrink-0 rounded-lg object-contain sm:w-2/5"
              loading="lazy"
              decoding="async"
            />
            {block.text && (
              <p className="min-w-0 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {block.text}
              </p>
            )}
          </div>
        );
      })}

      {/* The seller's plain description stays: it is the SEO/summary text and the
          fallback when a product has no blocks at all. */}
      {plain !== "" && (
        <div className="border-t border-slate-100 pt-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">{plain}</p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── EDITOR ──────────────────────────────── */

export interface DescriptionEditorProps {
  blocks: DescriptionBlock[];
  onChange: (blocks: DescriptionBlock[]) => void;
  /** Picks an image and resolves to a URL (R2 confirm → CDN URL). */
  onPickImage: (blockId: string) => Promise<string | null>;
  labels: {
    title: string;
    add: string;
    empty: string;
    textPlaceholder: (type: string) => string;
    imageHint: string;
    preview: string;
    uploading: string;
  };
}

export function ProductDescriptionEditor({
  blocks,
  onChange,
  onPickImage,
  labels,
}: DescriptionEditorProps) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<DescriptionBlock>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const pickImage = async (id: string) => {
    setUploadingId(id);
    try {
      const url = await onPickImage(id);
      if (url) update(id, { imageUrl: url });
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Block palette — one tap adds a block of that type at the end. */}
      <div className="flex flex-wrap gap-1.5">
        {BLOCK_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChange([...blocks, newBlock(type)])}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-brand hover:text-brand"
            >
              <Icon className="size-3.5" />
              <Plus className="size-3" aria-hidden />
              {BLOCK_TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>

      {blocks.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-400">
          {labels.empty}
        </p>
      )}

      <div className="space-y-2.5">
        {blocks.map((block, index) => {
          const Icon = TYPE_ICONS[block.type];
          const complete = blockIsComplete(block);
          return (
            <div
              key={block.id}
              className={cn(
                "rounded-xl border bg-white p-3 transition-colors",
                complete ? "border-slate-200" : "border-amber-300",
              )}
            >
              <div className="flex items-center gap-1.5">
                <GripVertical className="size-4 shrink-0 text-slate-300" aria-hidden />
                <Icon className="size-4 shrink-0 text-slate-500" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                  {BLOCK_TYPE_LABELS[block.type]}
                </span>
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  aria-label="เลื่อนขึ้น"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === blocks.length - 1}
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  aria-label="เลื่อนลง"
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(block.id)}
                  className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  aria-label="ลบบล็อก"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              {WANTS_TEXT[block.type] && (
                <textarea
                  value={block.text ?? ""}
                  onChange={(event) => update(block.id, { text: event.target.value })}
                  rows={block.type === "heading" ? 1 : 3}
                  placeholder={labels.textPlaceholder(BLOCK_TYPE_LABELS[block.type])}
                  className="mt-2.5 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:bg-white"
                />
              )}

              {WANTS_IMAGE[block.type] && (
                <div className="mt-2.5">
                  {block.imageUrl ? (
                    <div className="flex items-start gap-3">
                      <img
                        src={block.imageUrl}
                        alt={block.alt || labels.imageHint}
                        className="size-20 shrink-0 rounded-lg border border-slate-200 object-cover"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {block.type !== "image" && (
                          <input
                            value={block.alt ?? ""}
                            onChange={(event) => update(block.id, { alt: event.target.value })}
                            placeholder={labels.imageHint}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none focus:border-brand focus:bg-white"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => void pickImage(block.id)}
                          disabled={uploadingId === block.id}
                          className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                        >
                          {uploadingId === block.id ? labels.uploading : "เปลี่ยนรูป"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void pickImage(block.id)}
                      disabled={uploadingId === block.id}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-4 text-xs font-medium text-slate-500 transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                    >
                      {uploadingId === block.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ImagePlus className="size-4" />
                      )}
                      {uploadingId === block.id ? labels.uploading : "เพิ่มรูปภาพ"}
                    </button>
                  )}
                </div>
              )}

              {!complete && (
                <p className="mt-2 text-xs text-amber-600">
                  บล็อกนี้ยังไม่ครบ — จะไม่ถูกบันทึกจนกว่าจะกรอกข้อมูลให้ครบ
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
