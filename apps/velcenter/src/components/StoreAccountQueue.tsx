/**
 * StoreAccountQueue — the VelCenter review workspace for STORE ACCOUNTS.
 *
 * WHAT IT DECIDES
 *   A shop asked to buy wholesale. `approve` is the ONLY write in the whole
 *   system that makes `store_accounts.status = 'approved'`, which is the single
 *   gate (`lib/store-accounts.ts`) that decides whether the API sends a buyer the
 *   selling units a seller marked wholesale — i.e. a shop's wholesale PRICES.
 *   That is why this queue is permission-gated (`stores.manage`) at the endpoint,
 *   and why the backend refuses a reviewer's own application
 *   (`isSelfApproval`), the same rule the seller-verification route carries.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 *   It does not decide authorization (the endpoint re-checks role + grant on
 *   every request) and it does not count the queue itself: filtering, searching
 *   and paging all happen on the SERVER, and `pagination.total` is the exact
 *   filtered count — a locally filtered page would call the other rows "none".
 *
 * A FAILED READ IS AN ERROR, NEVER AN EMPTY LIST
 *   `catch { setRows([]) }` would render "no applications" when the request
 *   actually failed, and a reviewer would read that as a fact. The error state
 *   says so and offers a retry.
 */
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent } from "@velnox/shared/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Search,
  Store,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { emitCenterEvent, onCenterEvent } from "../lib/center-events";

/** Rows per page — mirrors `backend/lib/pagination.ts`. */
const PAGE_SIZE = 25;

interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface StoreAccountRow {
  id: string;
  userId: string;
  storeName: string;
  contactName: string;
  contactPhone: string;
  address: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  approved: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  applicantName: string | null;
  applicantEmail: string | null;
  reviewerName: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่ผ่าน",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default function StoreAccountQueue() {
  const listAccounts = useAction(api.centerAdmin.storeAccounts);
  const reviewAccount = useAction(api.centerAdmin.reviewStoreAccount);

  const [rows, setRows] = useState<StoreAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PageMeta | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Rejection always names a reason — the endpoint refuses an empty one, because
  // a rejection the applicant cannot act on is a dead end for both sides.
  const [rejecting, setRejecting] = useState<StoreAccountRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAccounts({ status: statusFilter, q: query || undefined, page, limit: PAGE_SIZE });
      setRows(res?.accounts ?? []);
      setPagination(res?.pagination ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคิวบัญชีร้านค้าไม่สำเร็จ");
      setRows([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [listAccounts, statusFilter, query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Server-side search: debounce the box, and go back to page 1 whenever the
  // result set changes (page 3 of the previous filter is meaningless).
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Another session's decision ("audit:created" for a store account) refreshes
  // this queue without a browser refresh.
  useEffect(() => onCenterEvent("stores", () => void load()), [load]);

  const decide = async (row: StoreAccountRow, decision: "approve" | "reject", reviewNote?: string) => {
    setBusyId(row.id);
    try {
      await reviewAccount({ accountId: row.id, decision, reviewNote });
      toast.success(decision === "approve" ? `อนุมัติ ${row.storeName} แล้ว 🎉` : `ปฏิเสธคำขอของ ${row.storeName} แล้ว`);
      setRejecting(null);
      setRejectReason("");
      await load();
      // The badge and any other open surface re-read too.
      emitCenterEvent("stores");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกผลการตรวจสอบไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["pending", "approved", "rejected", "all"] as const).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              className={`h-8 rounded-[10px] text-xs ${statusFilter === status ? "bg-slate-900 text-white" : ""}`}
              onClick={() => {
                setStatusFilter(status);
                setPage(1);
              }}
            >
              {status === "all" ? "ทั้งหมด" : STATUS_LABEL[status]}
              {status === "pending" && pagination && statusFilter === "pending" && pagination.total > 0 && (
                <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {pagination.total}
                </span>
              )}
            </Button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาร้าน / ผู้ติดต่อ / เบอร์โทร"
            className="h-9 rounded-[10px] border-slate-200 pl-8 text-xs"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </p>
          <Button variant="outline" size="sm" className="shrink-0 rounded-[10px]" onClick={() => void load()}>
            ลองใหม่
          </Button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> กำลังโหลด...
        </p>
      ) : !error && rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          ไม่มีคำขอในสถานะนี้
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="rounded-2xl border-slate-200">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <Store className="size-4 shrink-0 text-[#10B981]" />
                      <span className="truncate">{row.storeName}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {row.contactName} · {row.contactPhone}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {row.applicantName ?? "—"}
                      {row.applicantEmail ? ` · ${row.applicantEmail}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge className={STATUS_CLASS[row.status] ?? "bg-slate-100 text-slate-500"}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </Badge>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="size-3" />
                      {formatDateTime(row.createdAt)}
                    </span>
                  </div>
                </div>

                {row.address && <p className="mt-2 text-xs text-slate-500">ที่อยู่: {row.address}</p>}
                {row.note && <p className="mt-1 text-xs text-slate-500">หมายเหตุผู้สมัคร: {row.note}</p>}
                {row.reviewNote && (
                  <p className="mt-2 rounded-[10px] bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    ผลตรวจ: {row.reviewNote}
                    {row.reviewedAt ? ` · ${formatDateTime(row.reviewedAt)}` : ""}
                    {row.reviewerName ? ` · โดย ${row.reviewerName}` : ""}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {row.status !== "approved" && (
                    <Button
                      size="sm"
                      className="h-8 gap-1 rounded-[10px] bg-[#10B981] text-xs text-white hover:bg-[#059669]"
                      disabled={busyId === row.id}
                      onClick={() => void decide(row, "approve")}
                    >
                      {busyId === row.id ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                      อนุมัติ
                    </Button>
                  )}
                  {row.status !== "rejected" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 rounded-[10px] border-rose-200 text-xs text-rose-600 hover:bg-rose-50"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setRejecting(row);
                        setRejectReason(row.reviewNote ?? "");
                      }}
                    >
                      <XCircle className="size-3.5" />
                      ไม่ผ่าน
                    </Button>
                  )}
                  {row.status === "approved" && (
                    <span className="text-[11px] text-slate-400">บัญชีนี้เห็นราคาส่งจากผู้ขายที่เปิดขายส่งแล้ว</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pagination && pagination.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            หน้า {pagination.page} / {pagination.totalPages} · ทั้งหมด {pagination.total} คำขอ
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-[10px]"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-[10px]"
              disabled={!pagination.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ไม่ผ่านการอนุมัติ — {rejecting?.storeName}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            ระบุเหตุผลที่ผู้สมัครนำไปแก้ไขได้ (จำเป็น) — ผู้สมัครจะเห็นข้อความนี้และส่งคำขอใหม่ได้
          </p>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="เช่น ข้อมูลร้านไม่ครบ หรือติดต่อไม่ได้"
            rows={3}
            className="mt-2"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busyId === rejecting?.id}>
              ยกเลิก
            </Button>
            <Button
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={!rejectReason.trim() || busyId === rejecting?.id}
              onClick={() => rejecting && void decide(rejecting, "reject", rejectReason.trim())}
            >
              {busyId === rejecting?.id && <Loader2 className="size-4 animate-spin" />}
              ยืนยันไม่ผ่าน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
