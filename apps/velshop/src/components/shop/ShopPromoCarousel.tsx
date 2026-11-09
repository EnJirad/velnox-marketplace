import { useLanguage } from "@/lib/i18n";
import { Link } from "react-router";
import { ArrowRight, Sparkles, Store, Tag, Users, ShoppingBag } from "lucide-react";
import { useState, useEffect } from "react";

interface PromoItem {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  href: string;
  icon?: "shoppingbag" | "sparkles" | "store" | "tag" | "users";
  bgColor?: string;
  textColor?: string;
}

const DEFAULT_PROMOS: PromoItem[] = [
  {
    id: "flash-sale",
    title: "Flash Sale",
    subtitle: "Up to 70% off",
    href: "/products?sale=true",
    icon: "sparkles",
    bgColor: "bg-rose-500",
    textColor: "text-white",
  },
  {
    id: "new-arrivals",
    title: "New Arrivals",
    subtitle: "Just landed",
    href: "/products?sort=newest",
    icon: "store",
    bgColor: "bg-emerald-500",
    textColor: "text-white",
  },
  {
    id: "top-shops",
    title: "Top Shops",
    subtitle: "Verified sellers",
    href: "/shops?verified=true",
    icon: "shoppingbag",
    bgColor: "bg-blue-500",
    textColor: "text-white",
  },
  {
    id: "categories",
    title: "Categories",
    subtitle: "Browse all",
    href: "/categories",
    icon: "tag",
    bgColor: "bg-amber-500",
    textColor: "text-white",
  },
  {
    id: "community",
    title: "Community",
    subtitle: "Follow creators",
    href: "/community",
    icon: "users",
    bgColor: "bg-violet-500",
    textColor: "text-white",
  },
];

interface ShopPromoCarouselProps {
  /** Custom promo items (overrides defaults) */
  items?: PromoItem[];
  /** Auto-scroll interval (ms), 0 = disabled */
  autoScrollMs?: number;
  /** Show pagination dots */
  showDots?: boolean;
  /** Custom className */
  className?: string;
}

export function ShopPromoCarousel({
  items = DEFAULT_PROMOS,
  autoScrollMs = 5000,
  showDots = true,
  className,
}: ShopPromoCarouselProps) {
  const { t } = useLanguage();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const iconMap = {
    shoppingbag: ShoppingBag,
    sparkles: Sparkles,
    store: Store,
    tag: Tag,
    users: Users,
  } as const;

  // Auto-scroll
  useEffect(() => {
    if (autoScrollMs <= 0 || items.length <= 1) return;
    const interval = setInterval(() => {
      if (!isHovered) {
        setCurrentIndex((i) => (i + 1) % items.length);
      }
    }, autoScrollMs);
    return () => clearInterval(interval);
  }, [autoScrollMs, items.length, isHovered]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const nextSlide = () => {
    setCurrentIndex((i) => (i + 1) % items.length);
  };

  const prevSlide = () => {
    setCurrentIndex((i) => (i - 1 + items.length) % items.length);
  };

  const getIcon = (iconName: keyof typeof iconMap) => {
    const Icon = iconMap[iconName];
    return Icon ? <Icon className="size-6" /> : null;
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-slate-50 border border-slate-200 ${className || ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Slides */}
      <div className="relative h-32 sm:h-40 overflow-hidden">
        {items.map((item, index) => (
          <Link
            key={item.id}
            to={item.href}
            className={`absolute inset-0 flex items-center transition-opacity duration-300 ${
              index === currentIndex ? "opacity-100 z-10" : "opacity-0 -translate-x-full"
            }`}
            aria-label={item.title}
          >
            <div className="w-full h-full flex items-center px-4 sm:px-8">
              {/* Icon + Text */}
              <div className={`relative rounded-xl p-4 sm:p-6 ${item.bgColor || "bg-gradient-to-r from-emerald-500 to-emerald-600"} ${item.textColor || "text-white"} min-w-[200px] flex-shrink-0`}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center rounded-full bg-white/20 p-2">
                    {getIcon(item.icon || "sparkles")}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg sm:text-xl leading-tight">{item.title}</h3>
                    {item.subtitle && (
                      <p className="text-sm opacity-90">{item.subtitle}</p>
                    )}
                  </div>
                </div>
                {item.image && (
                  <img
                    src={item.image}
                    alt=""
                    className="absolute right-4 top-1/2 -translate-y-1/2 h-20 w-auto opacity-80"
                  />
                )}
                <ArrowRight className="absolute bottom-2 right-2 size-5 opacity-70" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Navigation arrows */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={prevSlide}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center rounded-full bg-white/90 text-slate-600 hover:bg-white shadow-md transition-all disabled:opacity-50"
            aria-label={t("carousel.prev")}
            disabled={items.length <= 1}
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={nextSlide}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center rounded-full bg-white/90 text-slate-600 hover:bg-white shadow-md transition-all disabled:opacity-50"
            aria-label={t("carousel.next")}
            disabled={items.length <= 1}
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </>
      )}

      {/* Pagination dots */}
      {showDots && items.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {items.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => goToSlide(index)}
              className={`w-2 h-2 rounded-full transition-[width,background-color] duration-300 ${
                index === currentIndex
                  ? "bg-emerald-500 w-5"
                  : "bg-slate-300 hover:bg-slate-400"
              }`}
              aria-label={t("carousel.goToSlide", { slide: index + 1 })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
