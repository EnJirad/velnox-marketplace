import { Link } from "react-router";
import { ArrowRight, ShoppingBag, Shield, Truck, Star, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/products/ProductCard";
import { ProductGridSkeleton } from "@/components/products/ProductGrid";
import { productsApi, categoriesApi } from "@/lib/api";
import type { Product, Category } from "@/types";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.08 } },
};

// Demo data for when API is not connected
const demoProducts: Product[] = [
  {
    id: "1", shopId: "s1", name: "Minimalist Ceramic Vase", slug: "ceramic-vase",
    description: "Hand-crafted ceramic vase with a clean, modern silhouette.", shortDescription: "Hand-crafted modern vase",
    price: 1290, compareAtPrice: 1590, currency: "THB", status: "active", featured: true,
    rating: 4.8, reviewCount: 124, soldCount: 342, categoryId: "c1",
    shop: { id: "s1", sellerId: "sel1", name: "Artisan Studio", slug: "artisan-studio", description: null, logo: null, cover: null, rating: 4.9, productCount: 48, createdAt: "" },
    images: [{ id: "i1", productId: "1", url: "", alt: "Ceramic Vase", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "2", shopId: "s2", name: "Organic Cotton Tote Bag", slug: "cotton-tote",
    description: "Sustainable everyday tote made from 100% organic cotton.", shortDescription: "Sustainable everyday tote",
    price: 590, compareAtPrice: null, currency: "THB", status: "active", featured: false,
    rating: 4.6, reviewCount: 89, soldCount: 1205, categoryId: "c2",
    shop: { id: "s2", sellerId: "sel2", name: "Eco Goods", slug: "eco-goods", description: null, logo: null, cover: null, rating: 4.7, productCount: 32, createdAt: "" },
    images: [{ id: "i2", productId: "2", url: "", alt: "Tote Bag", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "3", shopId: "s3", name: "Walnut Desk Organizer", slug: "desk-organizer",
    description: "Premium walnut wood desk organizer for a clutter-free workspace.", shortDescription: "Premium walnut organizer",
    price: 2490, compareAtPrice: 2990, currency: "THB", status: "active", featured: true,
    rating: 4.9, reviewCount: 67, soldCount: 189, categoryId: "c3",
    shop: { id: "s3", sellerId: "sel3", name: "Woodcraft", slug: "woodcraft", description: null, logo: null, cover: null, rating: 4.8, productCount: 56, createdAt: "" },
    images: [{ id: "i3", productId: "3", url: "", alt: "Desk Organizer", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "4", shopId: "s1", name: "Hand-Poured Soy Candle", slug: "soy-candle",
    description: "Premium soy wax candle with notes of cedar and vanilla.", shortDescription: "Cedar & vanilla candle",
    price: 450, compareAtPrice: null, currency: "THB", status: "active", featured: false,
    rating: 4.7, reviewCount: 203, soldCount: 876, categoryId: "c4",
    shop: { id: "s1", sellerId: "sel1", name: "Artisan Studio", slug: "artisan-studio", description: null, logo: null, cover: null, rating: 4.9, productCount: 48, createdAt: "" },
    images: [{ id: "i4", productId: "4", url: "", alt: "Soy Candle", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "5", shopId: "s4", name: "Stainless Steel Water Bottle", slug: "water-bottle",
    description: "Double-wall insulated bottle keeps drinks cold 24hrs or hot 12hrs.", shortDescription: "Insulated water bottle",
    price: 890, compareAtPrice: 1090, currency: "THB", status: "active", featured: true,
    rating: 4.5, reviewCount: 312, soldCount: 2103, categoryId: "c5",
    shop: { id: "s4", sellerId: "sel4", name: "Urban Life", slug: "urban-life", description: null, logo: null, cover: null, rating: 4.6, productCount: 78, createdAt: "" },
    images: [{ id: "i5", productId: "5", url: "", alt: "Water Bottle", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "6", shopId: "s2", name: "Linen Throw Pillow", slug: "linen-pillow",
    description: "Soft stonewashed linen pillow cover for a relaxed, natural look.", shortDescription: "Stonewashed linen pillow",
    price: 790, compareAtPrice: null, currency: "THB", status: "active", featured: false,
    rating: 4.4, reviewCount: 56, soldCount: 432, categoryId: "c6",
    shop: { id: "s2", sellerId: "sel2", name: "Eco Goods", slug: "eco-goods", description: null, logo: null, cover: null, rating: 4.7, productCount: 32, createdAt: "" },
    images: [{ id: "i6", productId: "6", url: "", alt: "Linen Pillow", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "7", shopId: "s3", name: "Bamboo Cutting Board Set", slug: "cutting-boards",
    description: "Set of 3 bamboo cutting boards in graduated sizes.", shortDescription: "3-piece bamboo set",
    price: 1190, compareAtPrice: 1490, currency: "THB", status: "active", featured: false,
    rating: 4.6, reviewCount: 145, soldCount: 567, categoryId: "c7",
    shop: { id: "s3", sellerId: "sel3", name: "Woodcraft", slug: "woodcraft", description: null, logo: null, cover: null, rating: 4.8, productCount: 56, createdAt: "" },
    images: [{ id: "i7", productId: "7", url: "", alt: "Cutting Boards", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
  {
    id: "8", shopId: "s4", name: "Canvas Backpack", slug: "canvas-backpack",
    description: "Heritage-style waxed canvas backpack with leather accents.", shortDescription: "Waxed canvas backpack",
    price: 2190, compareAtPrice: null, currency: "THB", status: "active", featured: true,
    rating: 4.8, reviewCount: 98, soldCount: 234, categoryId: "c8",
    shop: { id: "s4", sellerId: "sel4", name: "Urban Life", slug: "urban-life", description: null, logo: null, cover: null, rating: 4.6, productCount: 78, createdAt: "" },
    images: [{ id: "i8", productId: "8", url: "", alt: "Canvas Backpack", sortOrder: 0 }],
    createdAt: "", updatedAt: "",
  },
];

const demoCategories: Category[] = [
  { id: "c1", name: "Home Decor", slug: "home-decor", icon: "🏠", parentId: null },
  { id: "c2", name: "Fashion", slug: "fashion", icon: "👗", parentId: null },
  { id: "c3", name: "Office", slug: "office", icon: "💼", parentId: null },
  { id: "c4", name: "Wellness", slug: "wellness", icon: "🧘", parentId: null },
  { id: "c5", name: "Kitchen", slug: "kitchen", icon: "🍳", parentId: null },
  { id: "c6", name: "Living", slug: "living", icon: "🛋️", parentId: null },
];

export default function Landing() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [productsRes, categoriesRes] = await Promise.allSettled([
          productsApi.list({ featured: true, pageSize: 8 }),
          categoriesApi.list(),
        ]);
        if (productsRes.status === "fulfilled") setProducts(productsRes.value.items);
        else setProducts(demoProducts);
        if (categoriesRes.status === "fulfilled") setCategories(categoriesRes.value.categories);
        else setCategories(demoCategories);
      } catch {
        setProducts(demoProducts);
        setCategories(demoCategories);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const displayProducts = products.length > 0 ? products : demoProducts;
  const displayCategories = categories.length > 0 ? categories : demoCategories;

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-accent/5" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-accent/3 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <motion.div
            className="max-w-3xl"
            initial="initial"
            animate="animate"
            variants={stagger}
          >
            <motion.div variants={fadeUp} className="mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/5 px-3 py-1 text-xs font-medium text-accent">
                <Sparkles className="h-3 w-3" />
                Discover Unique Products
              </span>
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] text-balance"
            >
              The marketplace{" "}
              <span className="text-accent">curated</span>{" "}
              for modern living
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed"
            >
              Shop from independent sellers offering handpicked products
              designed for quality, sustainability, and everyday joy.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/products">
                <Button size="lg" className="text-base px-8">
                  Browse Products
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link to="/auth">
                <Button variant="outline" size="lg" className="text-base px-8">
                  Start Selling
                </Button>
              </Link>
            </motion.div>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            variants={fadeUp}
            initial="initial"
            animate="animate"
            className="mt-14 flex flex-wrap gap-8 sm:gap-12"
          >
            {[
              { icon: Truck, label: "Free Shipping", desc: "On orders over ฿1,000" },
              { icon: Shield, label: "Secure Payments", desc: "256-bit encryption" },
              { icon: Star, label: "Quality Guaranteed", desc: "Verified sellers only" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <item.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Categories */}
      <section className="border-y border-border/40 bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Browse Categories</h2>
            <Link
              to="/products"
              className="text-sm text-accent hover:text-accent/80 font-medium transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {displayCategories.map((cat) => (
              <Link
                key={cat.id}
                to={`/products?category=${cat.slug}`}
                className="group flex flex-col items-center gap-2.5 rounded-xl border border-border/60 bg-background p-4 transition-all hover:border-accent/30 hover:shadow-sm"
              >
                <span className="text-2xl">{cat.icon || "📦"}</span>
                <span className="text-xs font-medium text-center group-hover:text-accent transition-colors">
                  {cat.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold">Featured Products</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Handpicked by our team for quality and design
            </p>
          </div>
          <Link
            to="/products?featured=true"
            className="text-sm text-accent hover:text-accent/80 font-medium transition-colors hidden sm:block"
          >
            View all →
          </Link>
        </div>

        {loading ? (
          <ProductGridSkeleton />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {displayProducts.map((product, i) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
              >
                <ProductCard product={product} />
              </motion.div>
            ))}
          </div>
        )}

        <div className="mt-10 text-center sm:hidden">
          <Link to="/products">
            <Button variant="outline">
              View all products
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
          <div className="relative overflow-hidden rounded-2xl bg-primary px-8 py-12 sm:px-12 sm:py-16 text-center">
            <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-accent/20 opacity-80" />
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-bold text-primary-foreground">
                Ready to start selling?
              </h2>
              <p className="mt-3 text-primary-foreground/70 max-w-md mx-auto">
                Join hundreds of independent sellers on Velnox. Set up your shop in minutes and reach customers worldwide.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Link to="/auth">
                  <Button size="lg" variant="secondary" className="text-base px-8">
                    Open Your Shop
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
