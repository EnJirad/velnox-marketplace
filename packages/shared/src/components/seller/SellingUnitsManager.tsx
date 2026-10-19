/**
 * SellingUnitsManager — seller authoring for SETS and PACKS (selling units).
 *
 * WHY IT EXISTS
 *   The marketplace could only sell one piece at `products.price`, so a shop that
 *   restocks by the pack had no way to order "เซ็ต 6" for ฿55 instead of 6 separate
 *   bottles. The owner's requirement is a CHOICE on the product page — by the
 *   piece, or by the pack — which is exactly what a selling unit is. This is the
 *   authoring surface: the API and the storefront already ship
 *   (`backend/routes/product-selling-units.ts`, velShop's product page).
 *
 * THE MODEL (one authority: `backend/lib/selling-units.ts`)
 *   * a selling unit is `{ name, pieces, price, isWholesale }` — nothing else. No
 *     minimum-order engine, no tier table, no per-pack stock, and no second price
 *     table: `isWholesale` decides WHO is offered the unit (an approved store
 *     account, `lib/store-accounts.ts`), never WHAT it costs;
 *   * `pieces` is how many BASE pieces one of it is worth, and INVENTORY IS ALWAYS
 *     COUNTED IN BASE PIECES: 2 sets of 12 reserve, settle and count 24 sold
 *     through the one existing stock path;
 *   * the per-piece price is DERIVED for display only (`price / pieces`) and is
 *     never stored — a stored unit price drifts as soon as it rounds;
 *   * a unit belongs to the product, optionally to ONE of its variants.
 *
 * WHY RETIRE, NOT DELETE
 *   `DELETE` sets `status = 'inactive'`. Order lines carry their own snapshot, so
 *   retiring a set can never rewrite what a past order consumed or cost — the
 *   definition simply stops being offered. An inactive set can be re-activated.
 *
 * API (the only endpoints this component talks to)
 *   GET    /api/seller/products/:productId/selling-units
 *   POST   /api/seller/products/:productId/selling-units
 *   PATCH  /api/seller/products/:productId/selling-units/:unitId
 *   DELETE /api/seller/products/:productId/selling-units/:unitId
 *
 * The server is the authority on every rule (validation, ownership, one live
 * definition per size); this component validates only enough to give an immediate
 * message, and always surfaces the server's own error text verbatim.
 */
import { WHOLESALE_ENABLED } from "@velnox/shared/lib/features";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Check, Layers, Loader2, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const API_BASE = () => import.meta.env.VITE_API_URL || "";

interface SellingUnitRow {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  pieces: number;
  price: number;
  /** Derived server-side (`price / pieces`) — display only, never stored. */
  pricePerPiece: number;
  status: "active" | "inactive";
  sortOrder: number;
  /** Wholesale-only: an approved store account is its only audience. */
  isWholesale: boolean;
}

interface VariantChoice {
  id: string;
  name: string;
}

interface SellingUnitsManagerProps {
  productId: string;
  /** The product's single-piece price, to show what a set saves. Display only. */
  basePrice?: number;
  /** The product's unit word (ขวด / ชิ้น), used in the derived per-piece price. */
  baseUnit?: string;
}

interface UnitFormState {
  name: string;
  pieces: string;
  price: string;
  variantId: string;
  isWholesale: boolean;
}

const EMPTY_FORM: UnitFormState = { name: "", pieces: "", price: "", variantId: "", isWholesale: false };

function baht(value: number): string {
  return `฿${(Math.round(value * 100) / 100).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
}

export function SellingUnitsManager({ productId, basePrice = 0, baseUnit = "ชิ้น" }: SellingUnitsManagerProps) {
  const baseUrl = API_BASE();
  const [units, setUnits] = useState<SellingUnitRow[]>([]);
  const [variants, setVariants] = useState<VariantChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<UnitFormState>(EMPTY_FORM);
  const [form, setForm] = useState<UnitFormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readJson = async (res: Response) => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  /** The server's own message is the truth; only the fallback text is ours. */
  const serverMessage = (payload: any, fallback: string): string =>
    payload?.error?.message || fallback;

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/selling-units`, {
        credentials: "include",
      });
      const data = await readJson(res);
      if (data?.success) {
        setUnits(data.data ?? []);
        setError(null);
      } else {
        setError(serverMessage(data, "โหลดชุด/แพ็คไม่สำเร็จ"));
      }
    } catch {
      setError("โหลดชุด/แพ็คไม่สำเร็จ");
    }
    setLoading(false);
  }, [baseUrl, productId]);

  /** Variants are optional for a set — they only narrow which variant it sells. */
  const fetchVariants = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/variants`, {
        credentials: "include",
      });
      const data = await readJson(res);
      if (data?.success) {
        setVariants(
          (data.data ?? []).map((v: any) => ({
            id: String(v.id),
            // The option labels are what a shop recognises; the variant name is
            // the fallback for a variant authored without option values.
            name: String(v.optionLabels || v.name || "ตัวเลือก"),
          })),
        );
      }
    } catch {
      /* Variants are optional here: a failure only means the selector is empty. */
    }
  }, [baseUrl, productId]);

  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    fetchUnits();
    fetchVariants();
  }, [loaded, fetchUnits, fetchVariants]);

  /**
   * Client-side check only, so an obvious mistake is caught before a round trip.
   * Returns the server-facing payload, or null after setting the message.
   */
  const validate = (state: UnitFormState): { name: string; pieces: number; price: number } | null => {
    const name = state.name.trim();
    if (!name) {
      setError("กรอกชื่อชุด/แพ็ค เช่น เซ็ต 6");
      return null;
    }
    if (name.length > 60) {
      setError("ชื่อชุด/แพ็คยาวเกิน 60 ตัวอักษร");
      return null;
    }
    const pieces = Number(state.pieces);
    if (!Number.isInteger(pieces) || pieces <= 0) {
      setError("จำนวนชิ้นต่อชุดต้องเป็นจำนวนเต็มมากกว่า 0");
      return null;
    }
    const price = Number(state.price);
    if (!Number.isFinite(price) || price < 0) {
      setError("ราคาต่อชุดต้องเป็นตัวเลขที่ไม่ติดลบ");
      return null;
    }
    return { name, pieces, price: Math.round(price * 100) / 100 };
  };

  const createUnit = async () => {
    const parsed = validate(form);
    if (!parsed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/selling-units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...parsed,
          variantId: form.variantId || null,
          isWholesale: form.isWholesale,
        }),
      });
      const data = await readJson(res);
      if (data?.success) {
        setForm(EMPTY_FORM);
        setFormOpen(false);
        await fetchUnits();
        toast.success(`เพิ่ม "${parsed.name}" แล้ว`);
      } else {
        const message = serverMessage(data, "เพิ่มชุด/แพ็คไม่สำเร็จ");
        setError(message);
        toast.error(message);
      }
    } catch {
      setError("เพิ่มชุด/แพ็คไม่สำเร็จ");
      toast.error("เพิ่มชุด/แพ็คไม่สำเร็จ");
    }
    setSaving(false);
  };

  const startEdit = (unit: SellingUnitRow) => {
    setError(null);
    setEditingId(unit.id);
    setEditFields({
      name: unit.name,
      pieces: String(unit.pieces),
      price: String(unit.price),
      variantId: unit.variantId ?? "",
      isWholesale: unit.isWholesale === true,
    });
  };

  const saveEdit = async (unit: SellingUnitRow) => {
    const parsed = validate(editFields);
    if (!parsed) return;
    setBusyId(unit.id);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/api/seller/products/${productId}/selling-units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...parsed, isWholesale: editFields.isWholesale }),
      });
      const data = await readJson(res);
      if (data?.success) {
        setEditingId(null);
        await fetchUnits();
        toast.success("บันทึกชุด/แพ็คแล้ว");
      } else {
        const message = serverMessage(data, "บันทึกไม่สำเร็จ");
        setError(message);
        toast.error(message);
      }
    } catch {
      setError("บันทึกไม่สำเร็จ");
      toast.error("บันทึกไม่สำเร็จ");
    }
    setBusyId(null);
  };

  /** Status change only — `DELETE` is a retire, `PATCH` re-activates. */
  const setStatus = async (unit: SellingUnitRow, status: "active" | "inactive") => {
    setBusyId(unit.id);
    setError(null);
    try {
      const res = status === "inactive"
        ? await fetch(`${baseUrl}/api/seller/products/${productId}/selling-units/${unit.id}`, {
            method: "DELETE",
            credentials: "include",
          })
        : await fetch(`${baseUrl}/api/seller/products/${productId}/selling-units/${unit.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ status: "active" }),
          });
      const data = await readJson(res);
      if (data?.success) {
        await fetchUnits();
        toast.success(status === "inactive" ? "เลิกขายชุดนี้แล้ว" : "เปิดขายชุดนี้อีกครั้งแล้ว");
      } else {
        const message = serverMessage(data, "เปลี่ยนสถานะไม่สำเร็จ");
        setError(message);
        toast.error(message);
      }
    } catch {
      setError("เปลี่ยนสถานะไม่สำเร็จ");
      toast.error("เปลี่ยนสถานะไม่สำเร็จ");
    }
    setBusyId(null);
    setRetiringId(null);
  };

  const activeCount = units.filter((u) => u.status === "active").length;

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">
          ชุด / แพ็ค ({activeCount})
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-[#10B981]"
          onClick={() => { setFormOpen((v) => !v); setError(null); }}
        >
          <Plus className="size-3" />
          เพิ่มชุด/แพ็ค
        </Button>
      </div>

      <p className="mt-1 text-[11px] text-slate-400">
        ขายสินค้าเดียวกันเป็นชุดได้ เช่น เซ็ต 6 ราคา ฿55 — ลูกค้าเลือกซื้อทีละชิ้นหรือยกชุด
        สต็อกนับเป็นชิ้นเสมอ (ขาย 2 เซ็ต × 12 = 24 ชิ้น)
      </p>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-600">{error}</p>
      )}

      {formOpen && (
        <div className="mt-2 rounded-lg border border-dashed border-[#10B981] bg-[#ECFDF5]/50 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="col-span-2 grid gap-1">
              <Label className="text-[10px]">ชื่อชุด / แพ็ค</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-7 text-xs"
                placeholder="เช่น เซ็ต 6, ลัง 12"
                maxLength={60}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-[10px]">จำนวน{baseUnit}ต่อชุด</Label>
              <Input
                value={form.pieces}
                onChange={(e) => setForm((f) => ({ ...f, pieces: e.target.value }))}
                type="number"
                min="1"
                className="h-7 text-xs"
                placeholder="6"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-[10px]">ราคาต่อชุด (฿)</Label>
              <Input
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                type="number"
                min="0"
                step="0.5"
                className="h-7 text-xs"
                placeholder="55"
              />
            </div>
            {variants.length > 0 && (
              <div className="col-span-2 grid gap-1">
                <Label className="text-[10px]">ใช้กับตัวเลือก</Label>
                <select
                  className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                  value={form.variantId}
                  onChange={(e) => setForm((f) => ({ ...f, variantId: e.target.value }))}
                >
                  <option value="">ทั้งสินค้า (ไม่ระบุตัวเลือก)</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {/* PARKED 2026-10-19: the wholesale audience is out of the MVP, so a
              seller authors ordinary sets/packs only. The control, its copy and
              the `isWholesale` field all stay in source for when B2B returns. */}
          {WHOLESALE_ENABLED && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2 py-1.5">
              <input
                type="checkbox"
                className="mt-0.5 size-3.5 shrink-0 accent-[#10B981]"
                checked={form.isWholesale}
                onChange={(e) => setForm((f) => ({ ...f, isWholesale: e.target.checked }))}
              />
              <span className="min-w-0 text-[10px] leading-4 text-slate-600">
                <span className="font-semibold text-slate-700">ขายส่ง — เฉพาะร้านค้าที่อนุมัติ</span>
                <br />
                ลูกค้าทั่วไปจะไม่เห็นชุดนี้และราคานี้ ต้องมีบัญชีร้านค้าที่ผ่านการอนุมัติจาก VelCenter
              </span>
            </label>
          )}
          <p className="mt-1.5 text-[10px] text-slate-500">
            ฿ ต่อชิ้นที่แสดงให้ลูกค้า:{" "}
            <span className="font-medium text-slate-700">
              {Number(form.pieces) > 0 && Number(form.price) >= 0
                ? `${baht(Number(form.price) / Number(form.pieces))} / ${baseUnit}`
                : "—"}
            </span>
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={createUnit} disabled={saving}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              เพิ่มชุด/แพ็ค
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); setError(null); }}
              disabled={saving}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      )}

      {loading && units.length === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="size-3 animate-spin" />
          กำลังโหลด...
        </p>
      )}

      {!loading && units.length === 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          ยังไม่มีชุด/แพ็ค — สินค้านี้ขายทีละ{baseUnit}ตามปกติ
        </p>
      )}

      <div className="mt-2 space-y-1.5">
        {units.map((unit) => (
          <div key={unit.id} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
            {editingId === unit.id ? (
              <div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="col-span-2 grid gap-1">
                    <Label className="text-[10px]">ชื่อชุด / แพ็ค</Label>
                    <Input
                      value={editFields.name}
                      onChange={(e) => setEditFields((f) => ({ ...f, name: e.target.value }))}
                      className="h-7 text-xs"
                      maxLength={60}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[10px]">จำนวน{baseUnit}ต่อชุด</Label>
                    <Input
                      value={editFields.pieces}
                      onChange={(e) => setEditFields((f) => ({ ...f, pieces: e.target.value }))}
                      type="number"
                      min="1"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[10px]">ราคาต่อชุด (฿)</Label>
                    <Input
                      value={editFields.price}
                      onChange={(e) => setEditFields((f) => ({ ...f, price: e.target.value }))}
                      type="number"
                      min="0"
                      step="0.5"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                {WHOLESALE_ENABLED && (
                  <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[10px] text-slate-600">
                    <input
                      type="checkbox"
                      className="size-3.5 shrink-0 accent-[#10B981]"
                      checked={editFields.isWholesale}
                      onChange={(e) => setEditFields((f) => ({ ...f, isWholesale: e.target.checked }))}
                    />
                    <span>
                      <span className="font-semibold text-slate-700">ขายส่ง (เฉพาะร้านค้าที่อนุมัติ)</span>
                      {" "}— ลูกค้าทั่วไปไม่เห็นชุดนี้
                    </span>
                  </label>
                )}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => saveEdit(unit)} disabled={busyId === unit.id}>
                    {busyId === unit.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    บันทึก
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingId(null); setError(null); }}>
                    ยกเลิก
                  </Button>
                  <span className="text-[10px] text-slate-400">
                    แก้จำนวนชิ้นแล้ว ออเดอร์เก่ายังนับชิ้นเดิมที่ขายไปแล้ว
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1.5">
                  <Layers className="size-3.5 shrink-0 text-[#10B981]" />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{unit.name}</span>
                  {WHOLESALE_ENABLED && unit.isWholesale && (
                    <Badge className="shrink-0 bg-amber-50 text-[10px] text-amber-700">ขายส่ง</Badge>
                  )}
                  <Badge className={`shrink-0 text-[10px] ${unit.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {unit.status === "active" ? "ขายอยู่" : "เลิกขาย"}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="tabular-nums font-semibold text-slate-900">{baht(unit.price)}</span>
                  <span className="text-slate-500">/ ชุด · {unit.pieces} {baseUnit}</span>                  <span className="text-slate-400">= {baht(unit.pricePerPiece)} / {baseUnit}</span>
                  {WHOLESALE_ENABLED && unit.isWholesale && (
                    <span className="text-amber-700">เห็นเฉพาะร้านค้าที่อนุมัติ</span>
                  )}
                  {basePrice > 0 && (
                    <span className={unit.pricePerPiece < basePrice ? "text-emerald-600" : "text-slate-400"}>
                      {unit.pricePerPiece < basePrice
                        ? `ถูกกว่าขายปลีก ${baht(basePrice - unit.pricePerPiece)} / ${baseUnit}`
                        : `แพงกว่าขายปลีก ${baht(unit.pricePerPiece - basePrice)} / ${baseUnit}`}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px] text-slate-500 hover:text-slate-700" onClick={() => startEdit(unit)}>
                    <Pencil className="size-3" />
                    แก้ไข
                  </Button>
                  {unit.status === "active" ? (
                    retiringId === unit.id ? (
                      <>
                        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px] text-red-600" onClick={() => setStatus(unit, "inactive")} disabled={busyId === unit.id}>
                          {busyId === unit.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                          ยืนยันเลิกขาย
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-slate-500" onClick={() => setRetiringId(null)}>
                          <X className="size-3" />
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px] text-slate-500 hover:text-red-600" onClick={() => setRetiringId(unit.id)}>
                        <Trash2 className="size-3" />
                        เลิกขาย
                      </Button>
                    )
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px] text-slate-500 hover:text-[#10B981]" onClick={() => setStatus(unit, "active")} disabled={busyId === unit.id}>
                      {busyId === unit.id ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
                      เปิดขายอีกครั้ง
                    </Button>
                  )}
                </div>
                {retiringId === unit.id && (
                  <p className="mt-1 text-[10px] text-slate-400">
                    เลิกขายแล้วลูกค้าจะไม่เห็นชุดนี้อีก แต่ออเดอร์ที่ขายไปแล้วยังแสดงชื่อชุดเดิม
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
