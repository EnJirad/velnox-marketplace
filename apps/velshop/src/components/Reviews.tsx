/**
 * Product reviews — the original "Product reviews" block.
 *
 * One review per shopper (the database enforces it), editable and deletable by
 * its author only. The average and histogram are computed by the server; this
 * component renders them and never recomputes a rating.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi } from "@velnox/shared/mvp";
import { MvpErrorState, MvpLoading, formatDate, toMvpError, useMvpQuery } from "@velnox/shared/mvp/ui";
import { BadgeCheck, Loader2, Pencil, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/mvp/session";

function Stars({ value, className = "size-3.5" }: { value: number; className?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${className} ${
            star <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-slate-300"
          }`}
        />
      ))}
    </span>
  );
}

export function Reviews({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const { user } = useSession();
  const [page, setPage] = useState(1);
  const list = useMvpQuery(() => getMvpApi().reviews.list(slug, page), [slug, page]);
  const mine = useMvpQuery(
    () => (user ? getMvpApi().reviews.mine(slug) : Promise.resolve({ review: null, verifiedPurchase: false })),
    [slug, user?.id],
  );

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mine.data?.review) {
      setRating(mine.data.review.rating);
      setComment(mine.data.review.comment);
    }
  }, [mine.data?.review?.id]);

  const summary = list.data?.summary;
  const reviews = list.data?.reviews ?? [];
  const pagination = list.data?.pagination;
  const totalPages = pagination?.totalPages ?? (pagination ? Math.ceil(pagination.total / 5) : 1);

  const submit = async () => {
    if (!user) return;
    if (comment.trim().length === 0) {
      toast.error(t("productDetail.reviewRequired"));
      return;
    }
    setBusy(true);
    try {
      if (mine.data?.review) {
        await getMvpApi().reviews.update(mine.data.review.id, { rating, comment: comment.trim() });
        toast.success(t("productDetail.reviewUpdated"));
      } else {
        await getMvpApi().reviews.submit(slug, { rating, comment: comment.trim() });
        toast.success(t("productDetail.reviewSubmitted"));
      }
      setOpen(false);
      mine.reload();
      list.reload();
    } catch (err) {
      toast.error(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!mine.data?.review) return;
    setBusy(true);
    try {
      await getMvpApi().reviews.remove(mine.data.review.id);
      toast.success(t("productDetail.reviewDeleted"));
      setComment("");
      setRating(5);
      mine.reload();
      list.reload();
    } catch (err) {
      toast.error(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            {t("productDetail.reviews")}
          </h2>
          {summary && summary.count > 0 ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <Stars value={summary.average} />
              <span className="font-semibold tabular-nums">{summary.average.toFixed(1)}</span>
              <span className="text-slate-400">
                {t("productDetail.reviewsCount", { count: summary.count })}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">{t("productDetail.noReviews")}</p>
          )}
        </div>

        {user ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-9 gap-1.5 border-slate-200 text-slate-700"
              onClick={() => setOpen((value) => !value)}
            >
              <Pencil className="size-3.5" />
              {mine.data?.review ? t("productDetail.yourReview") : t("productDetail.writeReview")}
            </Button>
            {mine.data?.review && (
              <Button
                variant="ghost"
                className="h-9 gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-600"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {t("productDetail.deleteReview")}
              </Button>
            )}
          </div>
        ) : (
          <a
            href={`/auth?returnTo=${encodeURIComponent(`/products/${slug}`)}`}
            className="text-sm font-medium text-[#059669] hover:underline"
          >
            {t("productDetail.reviewLoginTitle")}
          </a>
        )}
      </div>

      {open && user && (
        <div className="mt-4 grid gap-3 rounded-xl bg-[#F8FAFC] p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">{t("productDetail.yourReview")}</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  aria-label={`${star} / 5`}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`size-5 ${
                      star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
          <textarea
            rows={3}
            value={comment}
            maxLength={2000}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t("productDetail.reviewCommentPlaceholder")}
            aria-label={t("productDetail.reviewCommentAria")}
            className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-9" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="h-9 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t("productDetail.submitReview")}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3">
        {list.loading ? (
          <MvpLoading label={t("productDetail.loadingReviews")} />
        ) : list.error ? (
          <MvpErrorState error={list.error} onRetry={list.reload} />
        ) : reviews.length === 0 ? (
          <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-sm text-slate-500">
            {t("productDetail.noReviews")}
          </p>
        ) : (
          reviews.map((review) => (
            <article key={review.id} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                    {review.authorAvatarUrl ? (
                      <img
                        src={review.authorAvatarUrl}
                        alt={review.authorName}
                        className="size-full object-cover"
                      />
                    ) : (
                      review.authorName.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="truncate text-sm font-medium text-slate-800">
                    {review.authorName}
                  </span>
                  {review.verifiedPurchase && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      <BadgeCheck className="size-3" />
                      {t("productDetail.verifiedPurchase")}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {formatDate(review.createdAt)}
                </span>
              </div>
              <div className="mt-1.5">
                <Stars value={review.rating} className="size-3" />
              </div>
              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">
                {review.comment}
              </p>
            </article>
          ))
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            ‹
          </Button>
          <span className="text-xs text-slate-500">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("productDetail.loadMoreReviews")}
          </Button>
        </div>
      )}
    </section>
  );
}
