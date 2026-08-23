import { Link, useNavigate } from "react-router";
import { Search, ShoppingBag, User, Menu, Package, MapPin, Settings } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@velnox/hooks";
import { useI18n } from "@velnox/i18n";
import { LanguageSelector } from "@velnox/ui/LanguageSelector";
import { CurrencySelector } from "@velnox/ui/CurrencySelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

export function Header() {
  const { user, isAuthenticated, login, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Mobile menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="lg:hidden">
            <Button variant="ghost" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72">
            <div className="flex flex-col gap-6 mt-6">
              <Link to="/" className="text-lg font-semibold tracking-tight" onClick={() => setMobileMenuOpen(false)}>Velnox</Link>
              <nav className="flex flex-col gap-3">
                <Link to="/products" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileMenuOpen(false)}>{t("nav.all_products")}</Link>
                <Link to="/products?featured=true" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileMenuOpen(false)}>{t("nav.featured")}</Link>
              </nav>
              <Separator />
              <div className="flex gap-2">
                <LanguageSelector />
                <CurrencySelector />
              </div>
              <Separator />
              {isAuthenticated ? (
                <div className="flex flex-col gap-3">
                  <span className="text-sm font-medium">{user?.name}</span>
                  <Link to="/orders" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}><Package className="h-4 w-4" /> {t("common.orders")}</Link>
                  <Link to="/addresses" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}><MapPin className="h-4 w-4" /> {t("common.address")}</Link>
                  <Link to="/profile" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}><Settings className="h-4 w-4" /> {t("common.settings")}</Link>
                  <Button variant="ghost" className="justify-start" onClick={() => { logout(); setMobileMenuOpen(false); }}>{t("common.logout")}</Button>
                </div>
              ) : (
                <Button onClick={() => { login(); setMobileMenuOpen(false); }}>{t("common.login")}</Button>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">V</div>
          <span className="hidden sm:block text-lg font-bold tracking-tight">Velnox</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-6 ml-8">
          <Link to="/products" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">{t("nav.all_products")}</Link>
          <Link to="/products?featured=true" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">{t("nav.featured")}</Link>
        </nav>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" placeholder={t("common.search_placeholder")} className="pl-9 bg-muted/50 border-transparent focus:bg-background focus:border-border" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </form>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <div className="hidden md:flex items-center gap-2 mr-2">
            <LanguageSelector />
            <CurrencySelector />
          </div>
          <Link to="/cart">
            <Button variant="ghost" size="icon" className="relative">
              <ShoppingBag className="h-5 w-5" />
              <span className="sr-only">{t("common.cart")}</span>
            </Button>
          </Link>
          {isAuthenticated ? (
            <Link to="/profile">
              <Button variant="ghost" size="icon" className="rounded-full">
                {user?.avatar ? (
                  <img src={user.avatar} alt={user.name} className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center">
                    <User className="h-4 w-4 text-accent-foreground" />
                  </div>
                )}
              </Button>
            </Link>
          ) : (
            <Button onClick={login} size="sm" className="hidden sm:inline-flex">{t("common.login")}</Button>
          )}
        </div>
      </div>
    </header>
  );
}
