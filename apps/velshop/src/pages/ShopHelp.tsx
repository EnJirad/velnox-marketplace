import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@velnox/shared/components/ui/accordion";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import {
  BadgePercent,
  CreditCard,
  Headphones,
  LifeBuoy,
  Mail,
  MessageCircle,
  Package,
  RefreshCw,
  Search,
  SearchX,
  ShoppingBag,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

interface HelpArticle {
  id: string;
  titleKey: string;
  descKey: string;
}

interface HelpCategory {
  id: string;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  articles: HelpArticle[];
}

/**
 * VelShop Help Center — real support destination for the profile/footer.
 *
 * Content is static help copy (localized), while every action is real:
 * "Chat with Velnox Support" opens the existing customer chat system (/chat),
 * email support is config-driven via VITE_SUPPORT_EMAIL (hidden when unset),
 * and article links point to real pages (orders, wishlist, velrepeat, ...).
 */
const CATEGORIES: HelpCategory[] = [
  {
    id: "orders",
    icon: Package,
    titleKey: "help.catOrders",
    descKey: "help.catOrdersDesc",
    articles: [
      { id: "orders-where", titleKey: "help.ordersWhere", descKey: "help.ordersWhereA" },
      { id: "orders-status", titleKey: "help.ordersStatus", descKey: "help.ordersStatusA" },
      { id: "orders-delivery", titleKey: "help.ordersDelivery", descKey: "help.ordersDeliveryA" },
      { id: "orders-cancel", titleKey: "help.ordersCancel", descKey: "help.ordersCancelA" },
      { id: "orders-return", titleKey: "help.ordersReturn", descKey: "help.ordersReturnA" },
    ],
  },
  {
    id: "payments",
    icon: CreditCard,
    titleKey: "help.catPayments",
    descKey: "help.catPaymentsDesc",
    articles: [
      { id: "pay-methods", titleKey: "help.payMethods", descKey: "help.payMethodsA" },
      { id: "pay-problem", titleKey: "help.payProblem", descKey: "help.payProblemA" },
      { id: "pay-cod", titleKey: "help.payCod", descKey: "help.payCodA" },
      { id: "pay-refund", titleKey: "help.payRefund", descKey: "help.payRefundA" },
    ],
  },
  {
    id: "account",
    icon: UserRound,
    titleKey: "help.catAccount",
    descKey: "help.catAccountDesc",
    articles: [
      { id: "acct-login", titleKey: "help.acctLogin", descKey: "help.acctLoginA" },
      { id: "acct-profile", titleKey: "help.acctProfile", descKey: "help.acctProfileA" },
      { id: "acct-avatar", titleKey: "help.acctAvatar", descKey: "help.acctAvatarA" },
      { id: "acct-security", titleKey: "help.acctSecurity", descKey: "help.acctSecurityA" },
    ],
  },
  {
    id: "velrepeat",
    icon: RefreshCw,
    titleKey: "help.catVelRepeat",
    descKey: "help.catVelRepeatDesc",
    articles: [
      { id: "vr-how", titleKey: "help.vrHow", descKey: "help.vrHowA" },
      { id: "vr-manage", titleKey: "help.vrManage", descKey: "help.vrManageA" },
      { id: "vr-pause", titleKey: "help.vrPause", descKey: "help.vrPauseA" },
    ],
  },
  {
    id: "shopping",
    icon: ShoppingBag,
    titleKey: "help.catShopping",
    descKey: "help.catShoppingDesc",
    articles: [
      { id: "shop-info", titleKey: "help.shopInfo", descKey: "help.shopInfoA" },
      { id: "shop-wishlist", titleKey: "help.shopWishlist", descKey: "help.shopWishlistA" },
      { id: "shop-cart", titleKey: "help.shopCart", descKey: "help.shopCartA" },
      { id: "shop-availability", titleKey: "help.shopAvailability", descKey: "help.shopAvailabilityA" },
    ],
  },
];

export default function ShopHelp() {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");

  const supportEmail = (import.meta.env as Record<string, string | undefined>).VITE_SUPPORT_EMAIL;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => ({
      ...cat,
      articles: cat.articles.filter((a) => {
        const haystack = [
          t(a.titleKey),
          t(a.descKey),
          t(cat.titleKey),
          t(cat.descKey),
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      }),
    })).filter((cat) => cat.articles.length > 0);
  }, [query, t]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero */}
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="bg-gradient-to-r from-[#0f766e] via-[#10B981] to-[#34d399] px-6 py-8 sm:px-8">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-50">
              <Headphones className="size-4" />
              {t("help.eyebrow")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {t("help.title")}
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-emerald-50/90">{t("help.desc")}</p>
            <div className="relative mt-5 max-w-md">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("help.searchPlaceholder")}
                className="h-11 rounded-[12px] border-white/40 bg-white pl-9 pr-3 text-sm shadow-sm"
                aria-label={t("help.searchPlaceholder")}
              />
            </div>
          </div>
        </section>

        {/* Categories */}
        <section className="mt-6 space-y-6">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100">
                <SearchX className="size-6 text-slate-400" />
              </span>
              <p className="mt-4 text-sm font-semibold text-slate-900">{t("help.searchEmpty")}</p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{t("help.searchEmptyDesc")}</p>
            </div>
          ) : (
            filtered.map((cat) => {
              const Icon = cat.icon;
              return (
                <section key={cat.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-[#ECFDF5] text-[#047857]">
                      <Icon className="size-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-slate-900">{t(cat.titleKey)}</h2>
                      <p className="mt-0.5 text-xs leading-5 text-slate-400">{t(cat.descKey)}</p>
                    </div>
                  </div>
                  <Accordion type="single" collapsible className="border-t border-slate-100 px-1">
                    {cat.articles.map((article) => (
                      <AccordionItem key={article.id} value={article.id} className="border-b border-slate-100 last:border-b-0">
                        <AccordionTrigger className="px-4 py-3.5 text-left text-sm font-medium text-slate-800 hover:no-underline [&[data-state=open]>svg]:text-[#10B981]">
                          {t(article.titleKey)}
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 text-sm leading-6 text-slate-500">
                          {t(article.descKey)}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </section>
              );
            })
          )}
        </section>

        {/* Contact support */}
        <section id="contact" className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
              <LifeBuoy className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-slate-900">{t("help.contactTitle")}</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-400">{t("help.contactDesc")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
              <Link to="/chat">
                <MessageCircle className="size-4" />
                {t("help.chatSupport")}
              </Link>
            </Button>
            {supportEmail && (
              <Button variant="outline" className="gap-1.5 border-slate-200 text-slate-700" asChild>
                <a href={`mailto:${supportEmail}`}>
                  <Mail className="size-4" />
                  {t("help.emailSupport")}
                </a>
              </Button>
            )}
            <Button variant="outline" className="gap-1.5 border-slate-200 text-slate-700" asChild>
              <Link to="/orders">
                <BadgePercent className="size-4" />
                {t("help.viewOrders")}
              </Link>
            </Button>
          </div>
        </section>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <MessageCircle className="size-3.5 text-[#10B981]" />
          {t("help.supportNote")}
        </p>
      </main>

      <ShopFooter />
    </div>
  );
}