import { Link } from "react-router";
import { ShoppingBag, Star } from "lucide-react";
import type { Product } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ProductCardProps { product: Product; }

function formatPrice(price: number, currency = "THB") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price);
}

export function ProductCard({ product }: ProductCardProps) {
  const primaryImage = product.images?.[0]?.url;
  const hasDiscount = product.compareAtPrice && product.compareAtPrice > product.price;
  const discountPercent = hasDiscount ? Math.round(((product.compareAtPrice! - product.price) / product.compareAtPrice!) * 100) : 0;

  return (
    <div className="group relative">
      <Link to={`/products/${product.id}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-muted">
          {primaryImage ? (
            <img src={primaryImage} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><ShoppingBag className="h-12 w-12 text-muted-foreground/30" /></div>
          )}
          <div className="absolute top-3 left-3 flex flex-col gap-1.5">
            {product.featured && <Badge className="bg-primary text-primary-foreground text-xs font-medium px-2.5">Featured</Badge>}
            {hasDiscount && <Badge className="bg-destructive text-destructive-foreground text-xs font-medium px-2.5">-{discountPercent}%</Badge>}
          </div>
          <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <Button size="icon" className="h-9 w-9 rounded-full bg-background/90 backdrop-blur-sm text-foreground shadow-lg hover:bg-background" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <ShoppingBag className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 px-0.5">
          {product.shop?.name && <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{product.shop.name}</p>}
          <h3 className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-accent transition-colors">{product.name}</h3>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{formatPrice(product.price, product.currency)}</span>
            {hasDiscount && <span className="text-sm text-muted-foreground line-through">{formatPrice(product.compareAtPrice!, product.currency)}</span>}
          </div>
          {product.rating !== null && (
            <div className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="text-xs font-medium">{product.rating.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">({product.reviewCount})</span>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}
