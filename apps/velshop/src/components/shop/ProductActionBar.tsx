import { useLanguage } from "@/lib/i18n";
import { Heart, Share2, Bookmark, MessageCircle, Loader2 } from "lucide-react";
import { useState, useCallback } from "react";
import { apiFetch } from "@velnox/shared/lib/api-client";

interface ProductActionBarProps {
  productId: string;
  /** Initial states (from product data) */
  initialLikeCount?: number;
  initialSaveCount?: number;
  initialShareCount?: number;
  initialCommentCount?: number;
  initialLiked?: boolean;
  initialSaved?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Callback when action state changes */
  onActionChange?: (action: "like" | "save" | "share", active: boolean) => void;
}

const ICON_SIZE = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

const SIZE_CLASSES = {
  sm: "p-1.5 gap-1 text-xs",
  md: "p-2 gap-2 text-sm",
  lg: "p-2.5 gap-2.5 text-base",
} as const;

export function ProductActionBar({
  productId,
  initialLikeCount = 0,
  initialSaveCount = 0,
  initialShareCount = 0,
  initialCommentCount = 0,
  initialLiked = false,
  initialSaved = false,
  size = "md",
  onActionChange,
}: ProductActionBarProps) {
  const { t } = useLanguage();
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [saveCount, setSaveCount] = useState(initialSaveCount);
  const [shareCount, setShareCount] = useState(initialShareCount);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [liked, setLiked] = useState(initialLiked);
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState<"like" | "save" | "share" | null>(null);

  const callAction = useCallback(
    async (action: "like" | "save" | "share", currentState: boolean) => {
      setLoading(action);
      try {
        const res = await apiFetch<{ success: boolean }>(`/products/${productId}/${action}`, {
          method: "POST",
        });
        if (res.success) {
          // Toggle local state optimistically (already done in onClick)
          onActionChange?.(action, !currentState);
        } else {
          // Revert on failure
          if (action === "like") setLiked(currentState);
          if (action === "save") setSaved(currentState);
        }
      } catch {
        if (action === "like") setLiked(currentState);
        if (action === "save") setSaved(currentState);
      } finally {
        setLoading(null);
      }
    },
    [productId, onActionChange]
  );

  const handleLike = () => {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => (next ? c + 1 : c - 1));
    callAction("like", liked);
  };

  const handleSave = () => {
    const next = !saved;
    setSaved(next);
    setSaveCount((c) => (next ? c + 1 : c - 1));
    callAction("save", saved);
  };

  const handleShare = async () => {
    // Increment share count locally
    setShareCount((c) => c + 1);

    // Try Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: document.title,
          url: window.location.href,
        });
        callAction("share", false);
        return;
      } catch {
        // User cancelled or error
      }
    }

    // Fallback: copy link
    try {
      await navigator.clipboard.writeText(window.location.href);
      // Could show toast here
    } catch {
      // Clipboard API not available
    }
    callAction("share", false);
  };

  const handleComment = () => {
    // Navigate to product detail with comments section
    window.location.href = `/products/${productId}?tab=reviews`;
  };

  const iconSize = ICON_SIZE[size];
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div
      className={`flex items-center ${sizeClass}`}
      role="group"
      aria-label={t("product.actionsLabel")}
    >
      {/* Like */}
      <button
        type="button"
        onClick={handleLike}
        disabled={loading === "like"}
        className={`flex items-center gap-1 rounded-squircle-sm transition-colors ${
          liked
            ? "bg-rose-50 text-rose-600"
            : "text-slate-400 hover:bg-slate-100 hover:text-rose-600"
        }`}
        aria-label={liked ? t("product.unlike") : t("product.like")}
        aria-pressed={liked}
      >
        <Heart
          className={`flex-shrink-0 ${liked ? "fill-current" : ""}`}
          style={{ width: iconSize, height: iconSize }}
        />
        <span className="font-medium tabular-nums">{likeCount > 999 ? "999+" : likeCount}</span>
      </button>

      {/* Save */}
      <button
        type="button"
        onClick={handleSave}
        disabled={loading === "save"}
        className={`flex items-center gap-1 rounded-squircle-sm transition-colors ${
          saved
            ? "bg-emerald-50 text-emerald-600"
            : "text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
        }`}
        aria-label={saved ? t("product.unsave") : t("product.save")}
        aria-pressed={saved}
      >
        <Bookmark
          className={`flex-shrink-0 ${saved ? "fill-current" : ""}`}
          style={{ width: iconSize, height: iconSize }}
        />
        <span className="font-medium tabular-nums">{saveCount > 999 ? "999+" : saveCount}</span>
      </button>

      {/* Share */}
      <button
        type="button"
        onClick={handleShare}
        className="flex items-center gap-1 rounded-squircle-sm text-slate-400 hover:bg-slate-100 hover:text-brand transition-colors"
        aria-label={t("product.share")}
      >
        <Share2 className="flex-shrink-0" style={{ width: iconSize, height: iconSize }} />
        <span className="font-medium tabular-nums">{shareCount > 999 ? "999+" : shareCount}</span>
      </button>

      {/* Comment */}
      <button
        type="button"
        onClick={handleComment}
        className="flex items-center gap-1 rounded-squircle-sm text-slate-400 hover:bg-slate-100 hover:text-brand transition-colors"
        aria-label={t("product.comment")}
      >
        <MessageCircle className="flex-shrink-0" style={{ width: iconSize, height: iconSize }} />
        <span className="font-medium tabular-nums">{commentCount > 999 ? "999+" : commentCount}</span>
      </button>
    </div>
  );
}
