import { Link } from "react-router";
import { useLanguage } from "@/lib/i18n";
import { Play, Zap, Eye, Clock } from "lucide-react";

interface LiveStream {
  id: string;
  title: string;
  sellerName: string;
  sellerAvatar?: string | null;
  thumbnailUrl?: string | null;
  viewerCount: number;
  isLive: boolean;
  productCount?: number;
  category?: string;
  scheduledAt?: string | null;
  href?: string;
}

interface LiveSectionProps {
  streams: LiveStream[];
  title?: string;
  viewAllHref?: string;
}

/**
 * LIVE section — Thaimart style live shopping streams.
 * Horizontal scrollable cards with live badges, viewer counts.
 */
export function LiveSection({ streams, title = "ไลฟ์สดตอนนี้", viewAllHref = "/live" }: LiveSectionProps) {
  const { t } = useLanguage();

  if (streams.length === 0) return null;

  const liveStreams = streams.filter((s) => s.isLive);
  const upcomingStreams = streams.filter((s) => !s.isLive);

  return (
    <section className="bg-white border-b border-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-red-100">
              <Zap className="size-4 text-red-600" />
            </span>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
          </div>
          {viewAllHref && (
            <Link
              to={viewAllHref}
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              {t("thaimartUi.liveSection.viewAll")}
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>

        {/* Live Now */}
        {liveStreams.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600 mb-3">
              <span className="relative flex size-2">
                <span className="absolute inset-0 rounded-full bg-red-600 animate-ping" />
                <span className="absolute inset-0 rounded-full bg-red-600" />
              </span>
              <span>{t("thaimartUi.liveSection.liveNowLabel")}</span>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
              {liveStreams.map((stream) => (
                <LiveStreamCard key={stream.id} stream={stream} isLive={true} />
              ))}
            </div>
          </div>
        )}

        {/* Upcoming */}
        {upcomingStreams.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-3">
              <Clock className="size-3.5" />
              <span>{t("thaimartUi.liveSection.upcoming")}</span>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
              {upcomingStreams.map((stream) => (
                <LiveStreamCard key={stream.id} stream={stream} isLive={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LiveStreamCard({ stream, isLive }: { stream: LiveStream; isLive: boolean }) {
  const { t } = useLanguage();

  return (
    <Link
      to={stream.href ?? `/live/${stream.id}`}
      className="shrink-0 w-64 flex flex-col"
      aria-label={`${stream.title} by ${stream.sellerName}`}
    >
      <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-slate-100">
        {stream.thumbnailUrl ? (
          <img
            src={stream.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-100 to-emerald-200">
            <Play className="size-12 text-emerald-400/60" />
          </div>
        )}

        {/* Live badge */}
        {isLive && (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-red-600 px-2 py-1 text-[11px] font-bold text-white">
            <span className="size-1.5 rounded-full bg-white animate-pulse" />
            <span>{t("thaimartUi.liveSection.liveNow")}</span>
          </span>
        )}

        {/* Viewer count */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
          <Eye className="size-3" />
          <span>{stream.viewerCount.toLocaleString()}</span>
        </div>

        {/* Scheduled time for upcoming */}
        {!isLive && stream.scheduledAt && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            <Clock className="size-3" />
            <span>{formatTime(stream.scheduledAt)}</span>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <h3 className="font-medium text-slate-900 line-clamp-1">{stream.title}</h3>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          {stream.sellerAvatar ? (
            <img
              src={stream.sellerAvatar}
              alt=""
              className="size-5 rounded-full"
            />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">
              {stream.sellerName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-medium text-slate-700 truncate">{stream.sellerName}</span>
          {stream.category && (
            <>
              <span className="text-slate-300">·</span>
              <span>{stream.category}</span>
            </>
          )}
        </div>
        {stream.productCount && stream.productCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-emerald-600">
            <Play className="size-2.5" />
            <span>{t("thaimartUi.liveSection.productsCount", { count: stream.productCount })}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}ชม.`;
  if (minutes > 0) return `${minutes}นาที`;
  return "ทันที";
}
