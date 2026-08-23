import { Link } from "react-router";
import { Minus, Plus, Trash2, ShoppingBag, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCart, useAuth } from "@velnox/hooks";
import { useI18n } from "@velnox/i18n";
import { formatPrice } from "@velnox/utils";

export default function Cart() {
  const { cart, itemCount, updateItem, removeItem } = useCart();
  const { isAuthenticated } = useAuth();
  const { t } = useI18n();

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-16 sm:py-24 text-center">
          <div className="mb-6">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <ShoppingBag className="h-8 w-8 text-muted-foreground/40" />
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-2">{t("common.cart")}</h1>
          <p className="text-muted-foreground mb-6">{t("common.welcome_message")}</p>
          <Link to="/auth">
            <Button size="lg">{t("common.login")}</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const items = cart?.items || [];
  const total = cart?.totalAmount || 0;

  if (items.length === 0) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-16 sm:py-24 text-center">
          <div className="mb-6">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <ShoppingBag className="h-8 w-8 text-muted-foreground/40" />
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-2">{t("common.cart")}</h1>
          <p className="text-muted-foreground mb-6">{t("common.no_products")}</p>
          <Link to="/products">
            <Button size="lg">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("common.browse_products")}
            </Button>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("common.cart")}</h1>
          <span className="text-sm text-muted-foreground">{itemCount} {t("common.items")}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            {items.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }} className="flex gap-4 rounded-xl border border-border/60 p-4">
                <div className="h-20 w-20 rounded-lg bg-muted overflow-hidden shrink-0">
                  {item.product?.images?.[0]?.url ? (
                    <img src={item.product.images[0].url} alt={item.product.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <ShoppingBag className="h-6 w-6 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/products/${item.productId}`} className="text-sm font-medium hover:text-accent transition-colors line-clamp-1">
                    {item.product?.name || "Product"}
                  </Link>
                  <p className="text-sm text-muted-foreground mt-0.5">{formatPrice(item.price)}</p>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-border rounded-lg">
                      <button onClick={() => updateItem(item.id, Math.max(1, item.quantity - 1))} className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="h-8 w-8 flex items-center justify-center text-sm">{item.quantity}</span>
                      <button onClick={() => updateItem(item.id, item.quantity + 1)} className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="lg:col-span-1">
            <div className="sticky top-24 rounded-xl border border-border/60 p-6 space-y-4">
              <h2 className="font-semibold">{t("common.order_summary")}</h2>
              <Separator />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("common.subtotal")} ({itemCount} {t("common.items")})</span>
                  <span className="font-medium">{formatPrice(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("common.shipping")}</span>
                  <span className="font-medium text-green-600">{t("common.free_shipping")}</span>
                </div>
              </div>
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>{t("common.total")}</span>
                <span>{formatPrice(total)}</span>
              </div>
              <Button className="w-full" size="lg">{t("common.proceed_to_checkout")}</Button>
              <Link to="/products" className="block text-center text-sm text-muted-foreground hover:text-foreground transition-colors">
                {t("common.continue_shopping")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
