import React, { useMemo } from "react";
import { RefreshCw, Search, ShoppingBag } from "lucide-react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import { Input } from "@velnox/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { formatThaiDate } from "@velnox/shared/lib/reorder";

export interface CustomerUser {
  readonly _id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly status: string;
  readonly createdAt: string | Date;
}

export interface CustomerUsersTabProps {
  readonly peopleCounts: { readonly customer: number; readonly seller: number };
  readonly customerUsers: readonly CustomerUser[] | null;
  readonly customerSearch: string;
  readonly onCustomerSearchChange: (value: string) => void;
  readonly onRefresh: () => void;
}

export const CustomerUsersTab: React.FC<CustomerUsersTabProps> = ({
  peopleCounts,
  customerUsers,
  customerSearch,
  onCustomerSearchChange,
  onRefresh,
}) => {
  const filteredCustomers = useMemo(() => {
    if (!customerUsers) return [];
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customerUsers;
    return customerUsers.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)),
    );
  }, [customerUsers, customerSearch]);

  return (
    <Card className="gap-0 border-slate-200 shadow-none">
      <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="size-4 text-brand" />
            บัญชีลูกค้า
          </CardTitle>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            ลูกค้า {peopleCounts.customer} บัญชี · ผู้ขาย {peopleCounts.seller} บัญชี —
            แยกตามบทบาทจริงในฐานข้อมูล
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 rounded-md border-slate-200 text-slate-600"
          onClick={onRefresh}
        >
          <RefreshCw className={`size-3.5 ${customerUsers === null ? "animate-spin" : ""}`} />
          รีเฟรช
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={customerSearch}
            onChange={(e) => onCustomerSearchChange(e.target.value)}
            placeholder="ค้นหาชื่อหรืออีเมลลูกค้า..."
            className="rounded-md pl-9"
          />
        </div>

        {customerUsers === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent">
              <ShoppingBag className="size-6 text-brand" />
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-900">
              {customerSearch ? "ไม่พบลูกค้าที่ค้นหา" : "ยังไม่มีบัญชีลูกค้า"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {customerSearch
                ? "ลองใช้คำค้นอื่น"
                : "บัญชีลูกค้าจะปรากฏที่นี่เมื่อมีผู้สมัครใช้งาน velshop"}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: Table layout */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
              <Table className="min-w-[620px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 text-slate-400">ลูกค้า</TableHead>
                    <TableHead className="text-slate-400">อีเมล</TableHead>
                    <TableHead className="text-slate-400">สมัครเมื่อ</TableHead>
                    <TableHead className="pr-4 text-right text-slate-400">สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map((c) => (
                    <TableRow key={c._id} className="hover:bg-slate-50/60">
                      <TableCell className="pl-4">
                        <p className="font-medium text-slate-900">
                          {c.name || "ลูกค้าที่ยังไม่ตั้งชื่อ"}
                        </p>
                        <p className="text-xs text-slate-400">#{c._id.slice(0, 8)}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{c.email ?? "—"}</TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatThaiDate(c.createdAt)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Badge
                          className={
                            c.status === "active"
                              ? "rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15"
                              : "rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15"
                          }
                        >
                          {c.status === "active" ? "ใช้งาน" : c.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: Card layout */}
            <div className="space-y-2 md:hidden">
              {filteredCustomers.map((c) => (
                <div key={c._id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {c.name || "ลูกค้าที่ยังไม่ตั้งชื่อ"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{c.email ?? "—"}</p>
                    </div>
                    <Badge
                      className={
                        c.status === "active"
                          ? "shrink-0 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15"
                          : "shrink-0 rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15"
                      }
                    >
                      {c.status === "active" ? "ใช้งาน" : c.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-2xs text-slate-400">
                    สมัครเมื่อ {formatThaiDate(c.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CustomerUsersTab;
