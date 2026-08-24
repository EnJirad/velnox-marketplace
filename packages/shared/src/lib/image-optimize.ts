/**
 * Image optimization utilities for Velnox.
 *
 * Two strategies:
 * 1. Cloudflare Image Resizing — when a custom domain proxied through Cloudflare
 *    is used, append `?width=X&format=webp&q=80` to get server-optimized images.
 * 2. Client-side compression — compress large images before upload to reduce
 *    initial payload (browser → R2).
 *
 * All profile images are always converted to WebP before upload.
 * R2 object keys are deterministic: profile/{kind}/{userId}.webp
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
 * Compress an image file and ALWAYS convert to WebP before uploading to R2.
 *
 * Strategy:
 * - Avatars: resize to max 512×512, WebP quality 85
 * - Covers:  resize to max 1920×1080, WebP quality 80
 *
 * Always outputs WebP. Returns the original file only if canvas/image decoding
 * is not available in the browser.
 */
export async function compressImage(
  file: File,
  kind: "avatar" | "cover",
  opts: { maxBytes?: number; quality?: number } = {},
): Promise<File> {
  const quality = opts.quality ?? (kind === "avatar" ? 0.85 : 0.80);

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

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return file; }

    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // Always output WebP
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });

    // If WebP is larger than original (rare for photos), still use WebP
    // to maintain the deterministic key structure and consistent format.
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch {
    // Canvas/ImageBitmap not supported or image decode failed — use original
    return file;
  }
}

/**
 * Get the file extension for an optimized file.
 * Profile images are always WebP after compression.
 */
export function getOptimizedExtension(file: File): string {
  if (file.type === "image/webp") return "webp";
  return "webp"; // default for profile images
}
