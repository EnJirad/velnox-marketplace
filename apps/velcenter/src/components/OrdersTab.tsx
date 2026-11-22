import React from "react";
import { AlertTriangle, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import {
  ORDER_STATUS_META,
  formatBaht,
  shortOrderId,
  formatThaiDate,
  type CenterOrderStatus,
} from "@velnox/shared/lib/shop";

export interface CenterOrderItem {
  readonly id: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unit: string;
}

export interface CenterOrder {
  readonly id: string;
  readonly orderNumber?: string | null;
  readonly shopName?: string | null;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly createdAt: number | string | Date;
  readonly itemCount: number;
  readonly items: readonly CenterOrderItem[];
  readonly total: number;
  readonly status: string;
}

export interface OrdersTabProps {
  readonly ordersData: readonly CenterOrder[] | null;
  readonly ordersLoading: boolean;
  readonly ordersLoadingMore: boolean;
  readonly ordersError: string | null;
  readonly ordersHasMore: boolean;
  readonly canManageOrders: boolean;
  readonly busyOrderId: string | null;
  readonly onLoadOrders: () => void;
  readonly onLoadMoreOrders: () => void;
  readonly onOrderStatusChange: (orderId: string, newStatus: string) => void;
  readonly getStatusOptions: (currentStatus: string) => readonly string[];
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  ordersData,
  ordersLoading,
  ordersLoadingMore,
  ordersError,
  ordersHasMore,
  canManageOrders,
  busyOrderId,
  onLoadOrders,
  onLoadMoreOrders,
  onOrderStatusChange,
  getStatusOptions,
}) => {
  if (ordersError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
        <AlertTriangle className="size-6 text-rose-400" />
        <p className="text-sm text-rose-600">{ordersError}</p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void onLoadOrders()}
        >
          <Loader2 className="size-3.5" /> ลองใหม่
        </Button>
      </div>
    );
  }

  if (ordersLoading || ordersData === null) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
          />
        ))}
      </div>
    );
  }

  if (ordersData.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent">
          <ShoppingBag className="size-7 text-brand" />
        </span>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">ยังไม่มีออเดอร์</h2>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
          เมื่อลูกค้าสั่งซื้อจาก velshop ออเดอร์ทั้งหมดจะถูกรวมอยู่ที่นี่
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Desktop: Table layout */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-slate-400">ออเดอร์ / ลูกค้า</TableHead>
              <TableHead className="text-slate-400">วันที่</TableHead>
              <TableHead className="text-slate-400">รายการ</TableHead>
              <TableHead className="text-right text-slate-400">ยอดรวม</TableHead>
              <TableHead className="pr-5 text-right text-slate-400">สถานะ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordersData.map((order) => {
              const meta = ORDER_STATUS_META[order.status as CenterOrderStatus] ?? {
                label: order.status,
                badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
                dot: "bg-slate-400",
              };

              return (
                <TableRow key={order.id} className="hover:bg-slate-50/60">
                  <TableCell className="pl-5">
                    <p className="font-medium text-slate-900">
                      {order.orderNumber ?? shortOrderId(order.id)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {order.shopName && (
                        <span className="font-medium text-slate-500">{order.shopName} · </span>
                      )}
                      {order.customerName} · {order.customerPhone}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-slate-600">{formatThaiDate(order.createdAt)}</p>
                    <p className="text-xs text-slate-400">{order.itemCount} ชิ้น</p>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-56 space-y-0.5">
                      {order.items.slice(0, 2).map((item) => (
                        <p key={item.id} className="truncate text-sm text-slate-600">
                          {item.productName} × {item.quantity} {item.unit}
                        </p>
                      ))}
                      {order.items.length > 2 && (
                        <p className="text-xs text-slate-400">+{order.items.length - 2} รายการ</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="font-semibold tabular-nums text-slate-900">
                      {formatBaht(order.total)}
                    </p>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {canManageOrders ? (
                      <Select
                        value={order.status}
                        onValueChange={(v) => onOrderStatusChange(order.id, v)}
                        disabled={busyOrderId === order.id}
                      >
                        <SelectTrigger className="ml-auto h-9 w-36 rounded-md border-slate-200 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getStatusOptions(order.status).map((s) => (
                            <SelectItem key={s} value={s}>
                              {(ORDER_STATUS_META[s as CenterOrderStatus] ?? { label: s }).label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge className={`gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                        <span className={`size-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: App-like order cards */}
      <div className="space-y-3 md:hidden">
        {ordersData.map((order) => {
          const meta = ORDER_STATUS_META[order.status as CenterOrderStatus] ?? {
            label: order.status,
            badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
            dot: "bg-slate-400",
          };

          return (
            <div
              key={order.id}
              className="rounded-xl border border-slate-200 bg-white p-4 transition-[transform,border-color,box-shadow,background-color] duration-200 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {order.orderNumber ?? shortOrderId(order.id)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {order.shopName && (
                      <span className="font-medium text-slate-500">{order.shopName} · </span>
                    )}
                    {order.customerName} · {order.customerPhone}
                  </p>
                </div>
                {canManageOrders ? (
                  <Select
                    value={order.status}
                    onValueChange={(v) => onOrderStatusChange(order.id, v)}
                    disabled={busyOrderId === order.id}
                  >
                    <SelectTrigger className="h-8 w-32 shrink-0 rounded-md border-slate-200 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getStatusOptions(order.status).map((s) => (
                        <SelectItem key={s} value={s}>
                          {(ORDER_STATUS_META[s as CenterOrderStatus] ?? { label: s }).label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge className={`shrink-0 gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                    <span className={`size-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </Badge>
                )}
              </div>

              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2.5">
                {order.items.slice(0, 2).map((item) => (
                  <p key={item.id} className="truncate text-sm text-slate-600">
                    {item.productName}{" "}
                    <span className="text-slate-400">× {item.quantity} {item.unit}</span>
                  </p>
                ))}
                {order.items.length > 2 && (
                  <p className="text-xs text-slate-400">+{order.items.length - 2} รายการ</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  {formatThaiDate(order.createdAt)} · {order.itemCount} ชิ้น
                </p>
                <p className="font-bold tabular-nums text-slate-900">{formatBaht(order.total)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination loader */}
      {ordersHasMore && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            className="min-w-44 gap-1.5 rounded-md border-slate-200 text-slate-700"
            onClick={() => void onLoadMoreOrders()}
            disabled={ordersLoadingMore}
          >
            {ordersLoadingMore ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {ordersLoadingMore ? "กำลังโหลดเพิ่มเติม..." : "โหลดออเดอร์เพิ่มเติม"}
          </Button>
        </div>
      )}

      {!canManageOrders && (
        <p className="mt-4 text-xs text-slate-400">
          โหมดพนักงาน: ดูข้อมูลได้ แต่เปลี่ยนสถานะออเดอร์ได้เฉพาะผู้ดูแลและเจ้าของบริษัท
        </p>
      )}
    </div>
  );
};

export default OrdersTab;
