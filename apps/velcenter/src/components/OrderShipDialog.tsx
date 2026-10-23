/**
 * VelCenter ship dialog — `packing → shipped` requires a REAL shipment.
 *
 * WHAT IT IS FOR
 * --------------
 * The fulfilment state machine (`backend/lib/order-fulfillment.ts`) refuses to
 * mark an order `shipped` unless a `shipments` row with a carrier AND a tracking
 * number exists — "shipped" is what tells the customer their parcel is on its
 * way, so it must never be a placeholder. The seller app asks for those two
 * values in its own dialog (`apps/velseller/src/pages/SellerOrderDetail.tsx`);
 * this is the VelCenter half, so an admin can dispatch an order too instead of
 * being refused by the server with no way to answer.
 *
 * WHY A HOST COMPONENT (imperative)
 * ---------------------------------
 * The orders table lives inside `pages/Center.tsx`, and that file is large enough
 * that its order rows sit past this repository's safe edit window (the same
 * constraint documented at the top of `packages/shared/src/lib/i18n/locales/th.ts`
 * — files can only be edited in their first ~32 KB). The per-row status `<Select>`
 * therefore cannot be rewired to open a dialog, so the dialog is driven
 * imperatively: Center's status handler calls `openOrderShipDialog(orderId)`, and
 * this host — mounted ONCE in `main.tsx` — renders it. One dialog, one store, one
 * place that knows the shipment requirement.
 *
 * WHAT IT DOES
 * ------------
 * Sends `carrier` + `trackingNumber` together with the `shipped` transition, so
 * the backend writes the status change and the shipment row in ONE transaction: a
 * refusal can never leave a half-created shipment behind. Success refreshes the
 * orders tab through the existing realtime `orders` event (`broadcast` in the
 * backend plus `emitCenterEvent`); a refusal is shown as it came from the server,
 * in Thai like the rest of this app.
 */
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { emitCenterEvent } from "../lib/center-events";

type Listener = () => void;

let pendingOrderId: string | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Ask for the carrier + tracking number of `orderId` and, on confirm, move the
 * order to `shipped` with them.
 */
export function openOrderShipDialog(orderId: string): void {
  pendingOrderId = orderId;
  notify();
}

function closeOrderShipDialog(): void {
  pendingOrderId = null;
  notify();
}

/** Mounted once in `main.tsx` — renders nothing until an order is shipped. */
export function OrderShipDialogHost() {
  const updateOrderStatus = useAction(api.centerAdmin.updateOrderStatusAction);

  const [orderId, setOrderId] = useState<string | null>(pendingOrderId);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [busy, setBusy] = useState(false);

  // One subscription for the whole app: `openOrderShipDialog()` from anywhere
  // opens this dialog, and no page has to hold the state.
  useEffect(() => {
    const sync = () => {
      setOrderId(pendingOrderId);
      setCarrier("");
      setTrackingNumber("");
    };
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const confirm = async () => {
    if (!orderId || busy) return;
    setBusy(true);
    try {
      await updateOrderStatus({
        orderId,
        status: "shipped",
        carrier: carrier.trim(),
        trackingNumber: trackingNumber.trim(),
      });
      toast.success("อัปเดตสถานะออเดอร์แล้ว");
      closeOrderShipDialog();
      // The status change is broadcast on `order:updated` (the tab follows it);
      // this keeps the list fresh even if the socket is down.
      emitCenterEvent("orders");
    } catch (error) {
      console.error("Ship order error:", error);
      toast.error(
        error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={orderId !== null}
      onOpenChange={(open) => {
        if (!open && !busy) closeOrderShipDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ยืนยันการจัดส่ง</DialogTitle>
          <DialogDescription>
            กรอกบริษัทขนส่งและเลขพัสดุก่อนยืนยัน — ระบบจะบันทึกข้อมูลการจัดส่งของออเดอร์นี้ทันที
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="center-ship-carrier">บริษัทขนส่ง</Label>
            <Input
              id="center-ship-carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="เช่น Kerry, Flash, ไปรษณีย์ไทย"
              disabled={busy}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="center-ship-tracking">เลขพัสดุ</Label>
            <Input
              id="center-ship-tracking"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="เช่น TH123456789"
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={closeOrderShipDialog} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
            onClick={() => void confirm()}
            disabled={busy || !carrier.trim() || !trackingNumber.trim()}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            ยืนยันจัดส่ง
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
