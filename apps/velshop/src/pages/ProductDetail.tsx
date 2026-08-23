import { useParams, Link } from "react-router";
import { useEffect, useState } from "react";
import { Star, ShoppingCart, Heart, ChevronLeft, Minus, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { productsApi } from "@/lib/api";
import { useCart } from "@/hooks/use-cart";
import type { Product } from "@/types";
import { toast } from "sonner";

function formatPrice(price: number, currency = "THB") { return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price); }

const demoProduct: Product = {
  id: "1", shopId: "s1", name: "Minimalist Ceramic Vase", slug: "ceramic-vase",
  description: "This hand-crafted ceramic vase features a clean, modern silhouette.\n\nPerfect for dried flowers, branches, or as a standalone decorative piece.",
  shortDescription: "Hand-crafted modern vase", price: 1290, compareAtPrice: 1590, currency: "THB", status: "active", featured: true, rating: 4.8, reviewCount: 124, soldCount: 342, categoryId: "c1",
  shop: { id: "s1", sellerId: "sel1", name: "Artisan Studio", slug: "artisan-studio", description: null, logo: null, cover: null, rating: 4.9, productCount: 48, createdAt: "" },
  images: [{ id: "i1", productId: "1", url: "", alt: "Ceramic Vase", sortOrder: 0 }],
  createdAt: "2025-01-15", updatedAt: "2025-06-01",
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const { addItem } = useCart();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try { const { product: p } = await productsApi.get(id!); if (!cancelled) setProduct(p); }
      catch { if (!cancelled) setProduct(demoProduct); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const handleAddToCart = async () => {
    if (!product) return;
    try { await addItem(product.id, quantity); toast.success("Added to cart", { description: `${product.name} × ${quantity}` }); }
    catch { toast.error("Could not add to cart", { description: "Please sign in first." }); }
  };

  if (loading) return (<Layout><div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8"><div className="grid grid-cols-1 lg:grid-cols-2 gap-10"><div className="aspect-square rounded-2xl bg-muted animate-pulse" /><div className="space-y-4"><div className="h-8 w-3/4 bg-muted rounded animate-pulse" /><div className="h-6 w-32 bg-muted rounded animate-pulse" /></div></div></div></Layout>);

  const p = product || demoProduct;
  const hasDiscount = p.compareAtPrice && p.compareAtPrice > p.price;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/products" className="hover:text-foreground flex items-center gap-1"><ChevronLeft className="h-3.5 w-3.5" />Products</Link><span>/</span><span className="text-foreground truncate">{p.name}</span>
        </nav>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
            <div className="aspect-square rounded-2xl bg-muted overflow-hidden mb-3">
              {p.images[selectedImage]?.url ? <img src={p.images[selectedImage].url} alt={p.images[selectedImage].alt} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground/30"><ShoppingCart className="h-24 w-24" /></div>}
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }} className="space-y-6">
            <div className="flex items-center gap-3">
              {p.shop && <Link to={`/shops/${p.shop.slug}`} className="text-sm text-muted-foreground hover:text-foreground font-medium">{p.shop.name}</Link>}
              {p.featured && <Badge className="text-xs">Featured</Badge>}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{p.name}</h1>
            {p.rating !== null && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.round(p.rating!) ? "fill-amber-400 text-amber-400" : "text-muted"}`} />)}</div>
                <span className="text-sm font-medium">{p.rating.toFixed(1)}</span>
                <span className="text-sm text-muted-foreground">({p.reviewCount} reviews)</span>
              </div>
            )}
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold">{formatPrice(p.price, p.currency)}</span>
              {hasDiscount && <><span className="text-lg text-muted-foreground line-through">{formatPrice(p.compareAtPrice!, p.currency)}</span><Badge variant="destructive" className="text-xs">Save {formatPrice(p.compareAtPrice! - p.price, p.currency)}</Badge></>}
            </div>
            <Separator />
            <div><h3 className="text-sm font-semibold mb-2">Description</h3><p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{p.description}</p></div>
            <Separator />
            <div className="flex items-center gap-4">
              <div className="flex items-center border border-border rounded-lg">
                <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground"><Minus className="h-4 w-4" /></button>
                <span className="h-10 w-10 flex items-center justify-center text-sm font-medium">{quantity}</span>
                <button onClick={() => setQuantity(quantity + 1)} className="h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground"><Plus className="h-4 w-4" /></button>
              </div>
              <Button size="lg" className="flex-1" onClick={handleAddToCart}><ShoppingCart className="mr-2 h-4 w-4" />Add to Cart</Button>
              <Button size="lg" variant="outline"><Heart className="h-4 w-4" /></Button>
            </div>
          </motion.div>
        </div>
      </div>
    </Layout>
  );
}
