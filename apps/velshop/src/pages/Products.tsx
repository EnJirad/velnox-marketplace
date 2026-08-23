import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { SlidersHorizontal, X } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { ProductGrid, ProductGridSkeleton } from "@/components/products/ProductGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { productsApi, categoriesApi } from "@/lib/api";
import type { Product, Category } from "@/types";

const demoProducts: Product[] = [
  { id: "1", shopId: "s1", name: "Minimalist Ceramic Vase", slug: "ceramic-vase", description: "Hand-crafted", shortDescription: "Hand-crafted modern vase", price: 1290, compareAtPrice: 1590, currency: "THB", status: "active", featured: true, rating: 4.8, reviewCount: 124, soldCount: 342, categoryId: "c1", shop: { id: "s1", sellerId: "sel1", name: "Artisan Studio", slug: "artisan-studio", description: null, logo: null, cover: null, rating: 4.9, productCount: 48, createdAt: "" }, images: [{ id: "i1", productId: "1", url: "", alt: "Vase", sortOrder: 0 }], createdAt: "", updatedAt: "" },
  { id: "2", shopId: "s2", name: "Organic Cotton Tote Bag", slug: "cotton-tote", description: "Sustainable", shortDescription: "Sustainable everyday tote", price: 590, compareAtPrice: null, currency: "THB", status: "active", featured: false, rating: 4.6, reviewCount: 89, soldCount: 1205, categoryId: "c2", shop: { id: "s2", sellerId: "sel2", name: "Eco Goods", slug: "eco-goods", description: null, logo: null, cover: null, rating: 4.7, productCount: 32, createdAt: "" }, images: [{ id: "i2", productId: "2", url: "", alt: "Tote", sortOrder: 0 }], createdAt: "", updatedAt: "" },
  { id: "3", shopId: "s3", name: "Walnut Desk Organizer", slug: "desk-organizer", description: "Premium", shortDescription: "Premium walnut organizer", price: 2490, compareAtPrice: 2990, currency: "THB", status: "active", featured: true, rating: 4.9, reviewCount: 67, soldCount: 189, categoryId: "c3", shop: { id: "s3", sellerId: "sel3", name: "Woodcraft", slug: "woodcraft", description: null, logo: null, cover: null, rating: 4.8, productCount: 56, createdAt: "" }, images: [{ id: "i3", productId: "3", url: "", alt: "Organizer", sortOrder: 0 }], createdAt: "", updatedAt: "" },
  { id: "4", shopId: "s4", name: "Water Bottle", slug: "water-bottle", description: "Insulated", shortDescription: "Insulated bottle", price: 890, compareAtPrice: 1090, currency: "THB", status: "active", featured: true, rating: 4.5, reviewCount: 312, soldCount: 2103, categoryId: "c5", shop: { id: "s4", sellerId: "sel4", name: "Urban Life", slug: "urban-life", description: null, logo: null, cover: null, rating: 4.6, productCount: 78, createdAt: "" }, images: [{ id: "i4", productId: "4", url: "", alt: "Bottle", sortOrder: 0 }], createdAt: "", updatedAt: "" },
];

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const search = searchParams.get("search") || "";
  const category = searchParams.get("category") || "";
  const featured = searchParams.get("featured") === "true";
  const page = parseInt(searchParams.get("page") || "1", 10);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [pr, cr] = await Promise.allSettled([productsApi.list({ search: search || undefined, category: category || undefined, featured: featured || undefined, page, pageSize: 12 }), categoriesApi.list()]);
        if (!cancelled) {
          if (pr.status === "fulfilled") { setProducts(pr.value.items); setTotal(pr.value.total); } else { setProducts(demoProducts); setTotal(demoProducts.length); }
          if (cr.status === "fulfilled") setCategories(cr.value.categories);
        }
      } catch { if (!cancelled) { setProducts(demoProducts); setTotal(demoProducts.length); } }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [search, category, featured, page]);

  const displayProducts = products.length > 0 ? products : demoProducts;
  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{featured ? "Featured Products" : search ? `Results for "${search}"` : "All Products"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{total > 0 ? `${total} products available` : "Discover our curated collection"}</p>
        </div>
        {(search || category || featured) && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="text-xs text-muted-foreground mr-1">Filters:</span>
            {search && <Badge variant="secondary" className="gap-1">Search: {search}<button onClick={() => updateParam("search", null)} className="ml-0.5 hover:text-foreground"><X className="h-3 w-3" /></button></Badge>}
            {category && <Badge variant="secondary" className="gap-1">Category: {category}<button onClick={() => updateParam("category", null)} className="ml-0.5 hover:text-foreground"><X className="h-3 w-3" /></button></Badge>}
            <button onClick={() => setSearchParams({})} className="text-xs text-accent hover:text-accent/80 font-medium ml-2">Clear all</button>
          </div>
        )}
        <div className="flex flex-col lg:flex-row gap-8">
          <aside className="lg:w-56 shrink-0">
            <div className="sticky top-24 space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />Categories</h3>
                <div className="space-y-1">
                  <button onClick={() => updateParam("category", null)} className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors ${!category ? "bg-accent/10 text-accent font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>All</button>
                  {categories.map((cat) => <button key={cat.id} onClick={() => updateParam("category", cat.slug)} className={`block w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors ${category === cat.slug ? "bg-accent/10 text-accent font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>{cat.name}</button>)}
                </div>
              </div>
            </div>
          </aside>
          <div className="flex-1">{loading ? <ProductGridSkeleton /> : <ProductGrid products={displayProducts} />}</div>
        </div>
      </div>
    </Layout>
  );
}
