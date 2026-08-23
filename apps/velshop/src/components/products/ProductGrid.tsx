import type { Product } from "@/types";
import { ProductCard } from "./ProductCard";

interface ProductGridProps { products: Product[]; }

export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4"><span className="text-2xl">🔍</span></div>
        <h3 className="text-lg font-medium mb-1">No products found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">Try adjusting your search or filter.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
      {products.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}

export function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <div className="aspect-[4/5] rounded-xl bg-muted animate-pulse" />
          <div className="space-y-2 px-0.5">
            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
            <div className="h-4 w-full bg-muted rounded animate-pulse" />
            <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
