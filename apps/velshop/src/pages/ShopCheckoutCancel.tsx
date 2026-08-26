import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { ArrowLeft, ShoppingCart, XCircle } from "lucide-react";
import { Link } from "react-router";

export default function ShopCheckoutCancel() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-slate-100">
          <XCircle className="size-8 text-slate-400" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
          {t("checkoutCancel.title")}
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
          {t("checkoutCancel.description")}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
            <Link to="/cart">
              <ShoppingCart className="size-4" />
              {t("checkoutCancel.backToCart")}
            </Link>
          </Button>
          <Button variant="outline" className="flex-1 border-slate-200 text-slate-700" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" />
              {t("checkout.continueShopping")}
            </Link>
          </Button>
        </div>
      </main>
      <ShopFooter />
    </div>
  );
}
