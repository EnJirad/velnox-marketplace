/**
 * Pure helpers for the seller product editor's image state.
 *
 * The editor keeps two lists (`gallery`, `detail`) that must always mirror what
 * the server returned, so an edit never loses stored images and a repeated save
 * never re-uploads an image that already has a database id.
 */

export interface ProductImageLike {
  id: string;
  url: string;
  imageType?: string | null;
  alt?: string | null;
  storageKey?: string | null;
  sortOrder?: number | null;
}

export interface DraftImageLike {
  /** Present only for images that already exist in the database. */
  id?: string;
  url: string;
  objectKey?: string;
  alt?: string;
}

export interface GalleryState {
  gallery: DraftImageLike[];
  detail: DraftImageLike[];
}

function toDraft(image: ProductImageLike): DraftImageLike {
  return {
    id: image.id,
    url: image.url,
    alt: image.alt ?? "",
    objectKey: image.storageKey ?? undefined,
  };
}

/** Server order is authoritative: `sort_order` ascending, then insertion order. */
function sorted(images: ProductImageLike[]): ProductImageLike[] {
  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => {
      const sa = a.image.sortOrder ?? 0;
      const sb = b.image.sortOrder ?? 0;
      return sa === sb ? a.index - b.index : sa - sb;
    })
    .map((entry) => entry.image);
}

/** Split stored images into the two galleries the editor renders. */
export function seedGalleries(images: ProductImageLike[] | null | undefined): GalleryState {
  const list = sorted(Array.isArray(images) ? images : []);
  return {
    gallery: list
      .filter((image) => (image.imageType ?? "gallery") === "gallery")
      .map(toDraft),
    detail: list.filter((image) => image.imageType === "detail").map(toDraft),
  };
}

/**
 * Images that still need a `save-image` call: drafts without a database id.
 * Anything the server already returned is skipped, which is what keeps a second
 * save from duplicating rows.
 */
export function pendingUploads(images: DraftImageLike[]): DraftImageLike[] {
  return images.filter((image) => !image.id && Boolean(image.url));
}
