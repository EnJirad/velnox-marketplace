/**
 * Image optimization utilities for Velnox.
 *
 * Two strategies:
 * 1. Cloudflare Image Resizing — when a custom domain proxied through Cloudflare
 *    is used, append `?width=X&format=webp&q=80` to get server-optimized images.
 * 2. Client-side compression — compress large images before upload to reduce
 *    initial payload (browser → R2).
 */

export function optimizedUrl(
  originalUrl: string,
  opts: { width?: number; format?: "webp" | "avif" | "auto"; quality?: number } = {},
): string {
  if (!originalUrl) return originalUrl;

  // r2.dev subdomains cannot be proxied through Cloudflare Image Resizing.
  if (originalUrl.includes(".r2.dev/")) return originalUrl;

  const qIndex = originalUrl.indexOf("?");
  const base = qIndex >= 0 ? originalUrl.slice(0, qIndex) : originalUrl;
  const existing = new URLSearchParams(qIndex >= 0 ? originalUrl.slice(qIndex + 1) : "");

  if (opts.width) existing.set("width", String(opts.width));
  if (opts.format) existing.set("format", opts.format);
  if (opts.quality) existing.set("q", String(opts.quality));

  const qs = existing.toString();
  return qs ? `${base}?${qs}` : base;
}

export function avatarSrcSet(originalUrl: string): string {
  if (!originalUrl) return "";
  return [
    { w: 96, desc: "96w" },
    { w: 128, desc: "128w" },
    { w: 256, desc: "256w" },
    { w: 512, desc: "512w" },
  ]
    .map(({ w, desc }) => `${optimizedUrl(originalUrl, { width: w, format: "webp", quality: 80 })} ${desc}`)
    .join(", ");
}

export function coverSrcSet(originalUrl: string): string {
  if (!originalUrl) return "";
  return [
    { w: 640, desc: "640w" },
    { w: 1280, desc: "1280w" },
    { w: 1920, desc: "1920w" },
  ]
    .map(({ w, desc }) => `${optimizedUrl(originalUrl, { width: w, format: "webp", quality: 80 })} ${desc}`)
    .join(", ");
}

/**
 * Compress an image file and ALWAYS convert to WebP before uploading to R2.
 *
 * If the browser cannot decode/encode, the ORIGINAL file is returned untouched —
 * never a file relabelled as `image/webp` whose bytes are still JPEG. Callers
 * must check the returned type and refuse a mislabelled upload.
 */
export async function compressImage(
  file: File,
  kind: "avatar" | "cover",
  opts: { maxBytes?: number; quality?: number } = {},
): Promise<File> {
  const quality = opts.quality ?? (kind === "avatar" ? 0.85 : 0.8);
  const maxW = kind === "avatar" ? 512 : 1920;
  const maxH = kind === "avatar" ? 512 : 1080;

  try {
    const bitmap = await createImageBitmap(file);
    let { width: w, height: h } = bitmap;

    if (w > maxW || h > maxH) {
      const scale = Math.min(maxW / w, maxH / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
}

export function getOptimizedExtension(file: File): string {
  if (file.type === "image/webp") return "webp";
  return "webp";
}
