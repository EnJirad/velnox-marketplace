/**
 * Image optimization utilities for Velnox.
 *
 * Two strategies:
 * 1. Cloudflare Image Resizing — when a custom domain proxied through Cloudflare
 *    is used, append `?width=X&format=webp&q=80` to get server-optimized images.
 * 2. Client-side compression — compress large images before upload to reduce
 *    initial payload (browser → R2).
 *
 * R2 public URLs are immutable (UUID-based objectKey) so they can be cached
 * indefinitely with `Cache-Control: public, max-age=31536000, immutable`.
 */

// ---------------------------------------------------------------------------
// 1. Cloudflare Image Resizing URL builder
// ---------------------------------------------------------------------------

/**
 * Build an optimized image URL via Cloudflare Image Resizing.
 *
 * Requires: the R2 custom domain must be proxied through Cloudflare AND
 * Image Resizing must be enabled in the Cloudflare dashboard.
 *
 * If the domain is an r2.dev subdomain (not proxied), returns the original URL
 * unchanged — the browser will display the full-resolution image.
 *
 * @param originalUrl - the canonical R2 public URL (e.g. pub-*.r2.dev/...)
 * @param opts.width  - target width in pixels
 * @param opts.format - output format ('webp', 'avif', 'auto')
 * @param opts.quality - compression quality 1-100 (default 80)
 */
export function optimizedUrl(
  originalUrl: string,
  opts: { width?: number; format?: "webp" | "avif" | "auto"; quality?: number } = {},
): string {
  if (!originalUrl) return originalUrl;

  // r2.dev subdomains cannot be proxied through Cloudflare Image Resizing.
  // Only append transform params when a custom domain is in use.
  if (originalUrl.includes(".r2.dev/")) return originalUrl;

  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.format) params.set("format", opts.format);
  if (opts.quality) params.set("q", String(opts.quality));

  const qs = params.toString();
  return qs ? `${originalUrl}?${qs}` : originalUrl;
}

/**
 * Generate srcset candidates for responsive image loading.
 * Returns an array of [url, widthDescriptor] pairs.
 *
 * Avatar sizes:  96w (mobile), 128w (normal), 256w (large profile), 512w (retina)
 * Cover sizes:   640w (mobile), 1280w (tablet), 1920w (desktop)
 */
export function avatarSrcSet(originalUrl: string): string {
  if (!originalUrl) return "";
  const sizes: Array<{ w: number; desc: string }> = [
    { w: 96, desc: "96w" },
    { w: 128, desc: "128w" },
    { w: 256, desc: "256w" },
    { w: 512, desc: "512w" },
  ];
  return sizes
    .map(({ w, desc }) => `${optimizedUrl(originalUrl, { width: w, format: "webp", quality: 80 })} ${desc}`)
    .join(", ");
}

export function coverSrcSet(originalUrl: string): string {
  if (!originalUrl) return "";
  const sizes: Array<{ w: number; desc: string }> = [
    { w: 640, desc: "640w" },
    { w: 1280, desc: "1280w" },
    { w: 1920, desc: "1920w" },
  ];
  return sizes
    .map(({ w, desc }) => `${optimizedUrl(originalUrl, { width: w, format: "webp", quality: 80 })} ${desc}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// 2. Client-side image compression before upload
// ---------------------------------------------------------------------------

/**
 * Compress a large image file using canvas before uploading to R2.
 *
 * Strategy:
 * - Avatars: resize to max 512×512, JPEG quality 85, output JPEG/WebP
 * - Covers:  resize to max 1920×1080, JPEG quality 80, output JPEG/WebP
 *
 * Skips compression if the file is already small enough (<threshold).
 * Returns the original file if compression fails or is unnecessary.
 */
export async function compressImage(
  file: File,
  kind: "avatar" | "cover",
  opts: { maxBytes?: number; quality?: number } = {},
): Promise<File> {
  const threshold = opts.maxBytes ?? (kind === "avatar" ? 200_000 : 500_000); // 200KB / 500KB
  const quality = opts.quality ?? (kind === "avatar" ? 0.85 : 0.80);

  // Already small enough — skip
  if (file.size <= threshold) return file;

  // Max dimensions per kind
  const maxW = kind === "avatar" ? 512 : 1920;
  const maxH = kind === "avatar" ? 512 : 1080;

  try {
    const bitmap = await createImageBitmap(file);
    let { width: w, height: h } = bitmap;

    // Scale down to fit within max dimensions
    if (w > maxW || h > maxH) {
      const scale = Math.min(maxW / w, maxH / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // If original is already small dimensions, don't upscale
    if (w >= bitmap.width && h >= bitmap.height) {
      bitmap.close();
      return file;
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return file; }

    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // Try WebP first (better compression), fall back to JPEG
    const outputType = "image/webp";
    const blob = await canvas.convertToBlob({ type: outputType, quality });
    if (blob.size >= file.size) {
      // Compression didn't help — use original
      return file;
    }

    const ext = outputType === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.${ext}`, { type: outputType });
  } catch {
    // Canvas/ImageBitmap not supported or image decode failed — use original
    return file;
  }
}

/**
 * Get the objectKey extension for a compressed file.
 * If the file was compressed to WebP, returns "webp".
 * Otherwise preserves the original extension.
 */
export function getOptimizedExtension(file: File): string {
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/avif") return "avif";
  return file.name.split(".").pop() ?? "jpg";
}
