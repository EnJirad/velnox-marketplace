import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent } from "@velnox/shared/components/ui/card";
import { Input } from "@velnox/shared/components/ui/input";
import { VerificationStatusLabel } from "@velnox/shared/components/VBadge";
import { VerificationReviewDialog, type ReviewDecision, type VerificationReviewRow } from "./VerificationReviewDialog";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Search,
  ShieldCheck,
  Store,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { onCenterEvent } from "../lib/center-events";

/** Rows per page — the queue is bounded; mirrors `backend/lib/pagination.ts`. */
const PAGE_SIZE = 25;

interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface VerificationRow {
  id: string;
  seller_id: string;
  status: string;
  verification_type?: string | null;
  evidence_count?: number | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  suspension_reason?: string | null;
  review_reason_code?: string | null;
  review_note?: string | null;
  shop_name?: string | null;
  shop_slug?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  seller_status?: string | null;
  verification_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export default function SellerVerificationQueue() {
  const { t } = useLanguage();
  const verificationsAction = useAction(api.admin.verifications);
  const sellerVerificationAction = useAction(api.admin.sellerVerificationAction);
  const revokeShopAction = useAction(api.centerAdmin.revokeShop);

  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  // Search runs on the SERVER: the queue is paginated, so filtering the current
  // page locally would search 25 rows and call the rest "no results".
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PageMeta | null>(null);

  // Review dialog
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewDialogRow, setReviewDialogRow] = useState<VerificationReviewRow | null>(null);
  const [acting, setActing] = useState(false);

  // Revoke dialog
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<VerificationRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const loadVerifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ONE request. The backend filters (`status=all` included), orders
      // deterministically and pages — the client no longer merges one list per
      // status, so the rows and the count always describe the same set.
      const res = await verificationsAction({
        status: statusFilter,
        q: query || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(res?.sellers ?? []);
      setPagination(res?.pagination ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการโหลดข้อมูล";
      setError(msg);
      setRows([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [verificationsAction, statusFilter, query, page]);

  useEffect(() => { void loadVerifications(); }, [loadVerifications]);

  // Debounce the search box into a server query, and return to page 1 whenever
  // the result set changes — page 3 of the previous filter is meaningless.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => { setPage(1); }, [statusFilter]);

  // A reviewed row leaves the queue. If that empties the last page, step back
  // instead of reporting "no items" over a page that still has rows behind it.
  useEffect(() => {
    if (!loading && !error && rows.length === 0 && page > 1) setPage((p) => p - 1);
  }, [loading, error, rows.length, page]);

  // Realtime: the Center page owns the WebSocket and notifies us when a seller
  // or verification changed, so a reviewed row leaves the list immediately.
  useEffect(() => onCenterEvent("sellers", () => { void loadVerifications(); }), [loadVerifications]);

  const openReview = useCallback((row: VerificationRow) => {
    setReviewDialogRow(row);
    setReviewDialogOpen(true);
  }, []);

  const handleDecision = useCallback(async (decision: ReviewDecision) => {
    if (!reviewDialogRow) return;
    setActing(true);
    try {
      await sellerVerificationAction({
        verificationId: reviewDialogRow.id,
        action: decision.action,
        reason: decision.reason,
        reasonCode: decision.reasonCode,
        note: decision.note,
      });
      toast.success(
        decision.action === "approve" ? "อนุมัติแล้ว ✅"
          : decision.action === "suspend" ? "ระงับแล้ว"
            : decision.action === "needs_correction" ? "ส่งคำขอแก้ไขแล้ว"
              : "ปฏิเสธแล้ว"
      );
      setReviewDialogOpen(false);
      void loadVerifications();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setActing(false);
    }
  }, [reviewDialogRow, sellerVerificationAction, loadVerifications]);

  const openRevoke = useCallback((row: VerificationRow) => {
    setRevokeTarget(row);
    setRevokeReason("");
    setRevokeOpen(true);
  }, []);

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget || !revokeReason.trim()) return;
    setRevoking(true);
    try {
      await revokeShopAction({ sellerId: revokeTarget.seller_id, reason: revokeReason.trim() });
      toast.success("ระงับและลบrêtailer แล้ว");
      setRevokeOpen(false);
      void loadVerifications();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, revokeReason, revokeShopAction, loadVerifications]);

  // Exact for the current filter, not just the current page: the backend returns
  // the filtered count in `pagination.total`.
  const pendingCount = statusFilter === "pending" ? (pagination?.total ?? 0) : 0;

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="ค้นหาร้านค้า, ผู้สมัคร, อีเมล..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-[10px]"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
          >
            <option value="pending">รอตรวจสอบ</option>
            <option value="all">ทั้งหมด</option>
            <option value="verified">ยืนยันแล้ว</option>
            <option value="rejected">ปฏิเสธ</option>
            <option value="suspended">ระงับ</option>
          </select>
        </div>
      </div>

      {/* Pending count */}
      {statusFilter === "pending" && pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <ShieldCheck className="size-4" />
          <span className="font-medium">{pendingCount} การยืนยันรอตรวจสอบ</span>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-red-300 bg-red-50/50 px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-red-100">
            <AlertTriangle className="size-7 text-red-500" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-slate-900">เกิดข้อผิดพลาด</h3>
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void loadVerifications()} className="mt-4 rounded-[10px]">
            ลองใหม่
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
            <ShieldCheck className="size-7 text-[#10B981]" />
          </span>
          <h3 className="mt-5 text-lg font-semibold text-slate-900">ไม่มีรายการ</h3>
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">
            {statusFilter === "pending" ? "ไม่มีการยืนยันรอตรวจสอบในขณะนี้" : "ไม่พบรายการตามเงื่อนไขที่เลือก"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id} className="border-slate-200 shadow-none">
              <CardContent className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Store className="size-4 shrink-0 text-[#10B981]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{row.shop_name ?? "—"}</p>
                      <VerificationStatusLabel status={(row.status === "unverified" ? "unverified" : row.status) as never} />
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {row.owner_name} · {row.owner_email}
                      {row.submitted_at && <span> · ส่งเมื่อ {new Date(row.submitted_at).toLocaleDateString()}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="rounded-[10px] text-xs" onClick={() => openReview(row)}>
                      <CheckCircle2 className="size-3.5 mr-1" /> ตรวจสอบ
                    </Button>
                    {row.status === "pending" && (
                      <Button size="sm" variant="outline" className="rounded-[10px] text-xs border-rose-200 text-rose-600 hover:bg-rose-50" onClick={() => openRevoke(row)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          </div>

          {/* Pagination — the reviewer never loads an unbounded seller table. */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-3 sm:flex-row">
            <p className="text-xs text-slate-500">
              ทั้งหมด {pagination?.total ?? rows.length} รายการ
              {pagination && pagination.totalPages > 1 && (
                <span> · หน้า {pagination.page} / {pagination.totalPages}</span>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-[10px] text-xs"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
              >
                <ChevronLeft className="size-3.5 mr-1" /> ก่อนหน้า
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-[10px] text-xs"
                disabled={!pagination?.hasMore || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                ถัดไป <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Review Dialog */}
      <VerificationReviewDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        row={reviewDialogRow}
        busy={acting}
        onDecision={handleDecision}
      />

      {/* Revoke Dialog */}
      {revokeOpen && revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRevokeOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="size-5" />
              <h3 className="text-lg font-semibold">ระงับและลบร้านค้า</h3>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <p>คุณกำลังจะระงับและลบร้านค้า <strong>{revokeTarget.shop_name}</strong> ออกจากระบบ</p>
              <p className="text-xs text-slate-500">การดำเนินการนี้จะ:</p>
              <ul className="list-disc pl-5 text-xs text-slate-500 space-y-1">
                <li>ระงับบัญชีผู้ขาย</li>
                <li>นำสินค้าทั้งหมดออกจากร้าน</li>
                <li>บันทึกประวัติการดำเนินการ</li>
              </ul>
              <div className="grid gap-2">
                <label className="text-xs font-medium text-slate-500">เหตุผลที่ระงับ *</label>
                <textarea
                  rows={3}
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="กรุณาระบุเหตุผล..."
                  className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevokeOpen(false)} disabled={revoking}>ยกเลิก</Button>
              <Button size="sm" className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleRevoke()} disabled={revoking || !revokeReason.trim()}>
                {revoking && <Loader2 className="size-3.5 animate-spin mr-1" />} ยืนยันระงับ
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
