import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api, ApiError } from "@velnox/shared/lib/api-routes";
import { formatIsoDateTime } from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  MapPin,
  Package,
  RefreshCw,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

interface TrackingEventRow {
  id: string;
  status: string;
  description: string | null;
  location: string | null;
  occurredAt: string;
}

interface ShipmentRow {
  id: string;
  carrier: string;
  carrierCode?: string | null;
  trackingNumber: string | null;
  status: string;
  estimatedDeliveryDate: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  trackingConfirmed?: boolean;
  events?: TrackingEventRow[];
}

interface OrderForTracking {
  id: string;
  orderNumber: string;
  status: string;
  shippingStatus: string;
  shipments?: ShipmentRow[];
}

export default function ShopTracking() {
  const { t } = useLanguage();
  const { orderId } = useParams<{ orderId: string }>();
  const orderDetail = useAction(api.customer.orderDetail);
  const refreshAction = useAction(api.customer.orderTrackingRefresh);
  const [order, setOrder] = useState<OrderForTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** HTTP status of the last failed load — null = network / non-HTTP error. */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  /** Translated label for a tracking status, falling back to the raw status. */
  const trackingLabel = useCallback(
    (status: string) => {
      const key = `trackingLabels.${status.toLowerCase()}`;
      const val = t(key);
      return val === key ? status : val;
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = (await orderDetail({ orderId })) as unknown as OrderForTracking;
      setOrder(data);
      setError(null);
      setErrorStatus(null);
    } catch (err) {
      setErrorStatus(err instanceof ApiError ? err.status : null);
      setError(err instanceof Error ? err.message : t("tracking.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [orderId, orderDetail, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    if (!orderId || refreshing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const view = (await refreshAction({ orderId })) as unknown as {
        message?: string;
      };
      if (view.message === "CARRIER_ERROR" || view.message === "CARRIER_NO_RECORD") {
        setRefreshMsg(t("tracking.refreshError"));
      } else if (view.message === "RECENTLY_CHECKED") {
        setRefreshMsg(t("tracking.recentlyChecked"));
      } else if (view.message === "UNSUPPORTED_CARRIER") {
        setRefreshMsg(t("tracking.refreshError"));
      }
      await load();
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : t("tracking.refreshError"));
    } finally {
      setRefreshing(false);
    }
  }, [orderId, refreshing, refreshAction, load, t]);

  const shipments = order?.shipments ?? [];
  const anyEvents = shipments.some((s) => (s.events?.length ?? 0) > 0);

  /**
   * Failure classification — never present a backend error as a confirmed
   * missing order. 401/403 need sign-in/access copy; 404 is a true not-found;
   * 5xx and network errors are temporary and get a Retry action.
   */
  const failView = useMemo(() => {
    if (!error) return { title: t("tracking.notFound"), desc: t("tracking.notFoundDesc"), retry: false };
    switch (errorStatus) {
      case 401:
        return { title: t("tracking.sessionExpired"), desc: t("tracking.sessionExpiredDesc"), retry: true };
      case 403:
        return { title: t("tracking.accessDenied"), desc: t("tracking.accessDeniedDesc"), retry: false };
      case 404:
        return { title: t("tracking.notFound"), desc: t("tracking.notFoundDesc"), retry: false };
      default:
        // 5xx, or a network failure (no HTTP status), or anything unexpected.
        if (typeof errorStatus === "number" && errorStatus >= 500) {
          return { title: t("tracking.serverError"), desc: t("tracking.serverErrorDesc"), retry: true };
        }
        return { title: t("tracking.networkError"), desc: t("tracking.networkErrorDesc"), retry: true };
    }
  }, [error, errorStatus, t]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : error || !order ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <Truck className="size-8 text-slate-300" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">{failView.title}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{failView.desc}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {failView.retry && (
                <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
                  <RefreshCw className="size-4" />
                  {t("tracking.retry")}
                </Button>
              )}
              <Button className={failView.retry ? "gap-1.5 border-slate-200 text-slate-600" : "gap-1.5 bg-slate-900 text-white hover:bg-slate-800"} variant={failView.retry ? "outline" : undefined} asChild>
                <Link to="/orders">
                  <ArrowLeft className="size-4" />
                  {t("tracking.backToOrders")}
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
                  <Truck className="size-4 text-brand" />
                  {t("tracking.eyebrow", { no: order.orderNumber })}
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{t("tracking.title")}</h1>
              </div>
              <Button variant="outline" className="border-slate-200 text-slate-600" asChild>
                <Link to={`/orders/${order.id}`}>
                  <Package className="size-4" />
                  {t("tracking.orderDetail")}
                </Link>
              </Button>
            </div>

            {shipments.length === 0 || !anyEvents ? (
              <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-50">
                  <Package className="size-7 text-slate-400" />
                </span>
                <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("tracking.notShipped")}</h2>
                <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("tracking.notShippedDesc")}</p>
              </div>
            ) : (
              <div className="mt-8 space-y-6">
                {shipments.map((s) => {
                  const events = [...(s.events ?? [])].reverse();
                  return (
                    <section key={s.id} className="rounded-2xl border border-slate-200 bg-white p-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-md bg-[#ECFDF5]">
                            <Truck className="size-4 text-brand" />
                          </span>
                          <div>
                              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                                {s.carrier}
                                {s.carrierCode && (
                                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-2xs font-medium text-slate-500">
                                    {s.carrierCode}
                                  </span>
                                )}
                              </p>
                              <p className="font-mono text-xs text-slate-500">{s.trackingNumber ?? t("tracking.noTrackingNo")}</p>
                              {s.lastCheckedAt && (
                                <p className="mt-0.5 text-2xs text-slate-400">
                                  {t("tracking.lastChecked", { time: formatIsoDateTime(s.lastCheckedAt) })}
                                </p>
                              )}
                              {s.lastError && (
                                <p className="mt-0.5 text-2xs text-amber-600">
                                  {t("tracking.carrierError", { code: s.lastError })}
                                </p>
                              )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="gap-1.5 rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-[#ECFDF5]">
                            <span className="size-1.5 rounded-full bg-brand" />
                            {trackingLabel(s.status)}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 border-slate-200 text-slate-600"
                            disabled={refreshing}
                            onClick={() => void onRefresh()}
                          >
                            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
                            {refreshing ? t("tracking.refreshing") : t("tracking.refresh")}
                          </Button>
                        </div>
                      </div>

                  {refreshMsg && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                      {refreshMsg}
                    </p>
                  )}

                      {s.estimatedDeliveryDate && (
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock3 className="size-3.5" />
                          {t("tracking.eta", { date: formatIsoDateTime(s.estimatedDeliveryDate) })}
                        </p>
                      )}

                      <div className="mt-6">
                        {events.map((e, i) => {
                          const isLatest = i === 0;
                          const done = isLatest;
                          return (
                            <div key={e.id} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <span
                                  className={`mt-1 flex size-6 items-center justify-center rounded-full ${
                                    done ? "bg-brand text-white" : "bg-slate-100 text-slate-400"
                                  }`}
                                >
                                  {done ? <CheckCircle2 className="size-3.5" /> : <span className="size-2 rounded-full bg-slate-300" />}
                                </span>
                                {i < events.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
                              </div>
                              <div className={`pb-6 ${i === events.length - 1 ? "pb-0" : ""}`}>
                                <p className={`text-sm font-medium ${done ? "text-slate-900" : "text-slate-600"}`}>
                                  {trackingLabel(e.status)}
                                </p>
                                {e.description && <p className="mt-0.5 text-xs text-slate-500">{e.description}</p>}
                                <p className="mt-0.5 flex items-center gap-1 text-2xs text-slate-400">
                                  {e.location && (
                                    <>
                                      <MapPin className="size-3" />
                                      {e.location} ·
                                    </>
                                  )}
                                  {formatIsoDateTime(e.occurredAt)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      <ShopFooter />
    </div>
  );
}
