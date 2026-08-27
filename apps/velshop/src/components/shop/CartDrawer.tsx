import { Logo } from "@velnox/shared/components/Logo";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@velnox/shared/components/ui/sheet";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { formatBaht } from "@velnox/shared/lib/shop";
import { ImageOff, LogIn, Minus, Plus, ShoppingCart, Trash2, UserPlus } from "lucide-react";
import { useNavigate } from "react-router";

interface CartDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CartDrawer({ open, onOpenChange }: CartDrawerProps) {
  const { lines, count, total, setQty, remove } = useCart();
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const goCheckout = () => {
    onOpenChange(false);
    navigate(isAuthenticated ? "/checkout" : "/auth?returnTo=/checkout");
  };

  const goLogin = () => {
    onOpenChange(false);
    navigate("/auth?returnTo=/");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="size-4 text-[#10B981]" />
            {t("cart.title")}
            {count > 0 && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                {count}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("cartDrawer.summary")}</SheetDescription>
        </SheetHeader>

        {!isAuthenticated ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <ShoppingCart className="size-6 text-slate-400" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">กรุณาสมัครสมาชิกหรือเข้าสู่ระบบก่อนใช้งานตะกร้า</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">เข้าสู่ระบบเพื่อบันทึกสินค้าในตะกร้าและดำเนินการชำระเงิน</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                onClick={goLogin}
              >
                <LogIn className="size-4" />
                เข้าสู่ระบบ
              </Button>
              <Button
                variant="outline"
                className="gap-1.5 border-slate-200 text-slate-700"
                onClick={() => {
                  onOpenChange(false);
                  navigate("/auth?returnTo=/");
                }}
              >
                <UserPlus className="size-4" />
                สมัครสมาชิก
              </Button>
            </div>
          </div>
        ) : lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <ShoppingCart className="size-6 text-slate-400" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{t("cartDrawer.emptyTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{t("cartDrawer.emptyDesc")}</p>
            </div>
            <Button
              variant="outline"
              className="border-slate-200 text-slate-700"
              onClick={() => {
                onOpenChange(false);
                navigate("/");
              }}
            >
              {t("cartDrawer.viewProducts")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {lines.map((line) => (
                <div
                  key={line.productId}
                  className="flex min-w-0 items-start gap-3 overflow-hidden rounded-xl border border-slate-200 p-3"
                >
                  {line.imageUrl ? (
                    <img
                      src={line.imageUrl}
                      alt={line.name}
                      className="size-14 shrink-0 rounded-lg border border-slate-100 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center rounded-lg bg-slate-50">
                      <ImageOff className="size-4 text-slate-300" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="block min-w-0 max-w-full truncate text-sm font-medium text-slate-900" title={line.name} style={{ overflowWrap: "anywhere" }}>{line.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatBaht(line.price)} {t("cart.perUnit", { unit: line.unit })}
                    </p>
                    <div className="mt-2 flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 border-slate-200 text-slate-600"
                        onClick={() => setQty(line.productId, line.qty - 1)}
                        aria-label={t("cartDrawer.ariaDecrease")}
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">
                        {line.qty}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 border-slate-200 text-slate-600"
                        onClick={() => setQty(line.productId, line.qty + 1)}
                        disabled={line.qty >= line.stock}
                        aria-label={t("cartDrawer.ariaIncrease")}
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatBaht(line.qty * line.price)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-slate-400 hover:text-red-600"
                      onClick={() => remove(line.productId)}
                      aria-label={t("cartDrawer.ariaRemove", { name: line.name })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{t("cartDrawer.totalLabel")}</p>
                <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">
                  {formatBaht(total)}
                </p>
              </div>
              <Button
                className="mt-3 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                onClick={goCheckout}
              >
                <ShoppingCart className="size-4" />
                {t("cartDrawer.checkoutCta")}
              </Button>
            </div>
          </>
        )}

        <div className="flex items-center justify-center gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <Logo />
          <p className="text-[11px] text-slate-400">{t("cartDrawer.tagline")}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
