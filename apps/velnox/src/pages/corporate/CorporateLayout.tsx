import { Logo } from "@velnox/shared/components/Logo";
import { Button } from "@velnox/shared/components/ui/button";
import { cn } from "@velnox/shared/lib/utils";
import { SITE_URLS } from "@velnox/shared/lib/sites";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";

type NavItem = { to: string; label: string; exact?: boolean };

const NAV: NavItem[] = [
  { to: "/", label: "หน้าแรก", exact: true },
  { to: "/about", label: "เกี่ยวกับ" },
  { to: "/vision", label: "วิสัยทัศน์" },
  { to: "/business", label: "ธุรกิจ" },
  { to: "/ecosystem", label: "ระบบนิเวศ" },
  { to: "/technology", label: "เทคโนโลยี" },
  { to: "/news", label: "ข่าวสาร" },
  { to: "/contact", label: "ติดต่อ" },
];

const TITLES: Record<string, string> = {
  "/": "Velnox Group — ซื้อขายจริง ทั้งปลีกและส่ง",
  "/about": "เกี่ยวกับ Velnox — Velnox Group",
  "/vision": "วิสัยทัศน์และพันธกิจ — Velnox Group",
  "/business": "ธุรกิจของเรา — Velnox Group",
  "/ecosystem": "ระบบนิเวศ Velnox — VelShop · VelSeller · VelCenter",
  "/technology": "เทคโนโลยี — Velnox Group",
  "/careers": "ร่วมงานกับเรา — Velnox Group",
  "/news": "ข่าวสารและประกาศ — Velnox Group",
  "/privacy": "นโยบายความเป็นส่วนตัว — Velnox Group",
  "/terms": "ข้อกำหนดการใช้งาน — Velnox Group",
  "/contact": "ติดต่อเรา — Velnox Group",
};

function FooterLink({ to, external, children }: { to: string; external?: boolean; children: React.ReactNode }) {
  const cls = "text-sm text-slate-500 transition-colors hover:text-slate-900";
  if (external) {
    return (
      <a
        href={to}
        className={cn(cls, "inline-flex items-center gap-1")}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
        <ArrowUpRight className="size-3.5" />
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      {children}
    </Link>
  );
}

export function CorporateLayout() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.title = TITLES[pathname] ?? TITLES["/"];
    window.scrollTo(0, 0);
  }, [pathname]);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.to : pathname.startsWith(item.to);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/15 bg-brand">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" onClick={() => setOpen(false)} aria-label="Velnox Group — หน้าแรก">
            <Logo tone="light" wordmarkClassName="max-w-[90px] overflow-hidden truncate" />
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="เมนูหลัก">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive(item)
                    ? "bg-white/20 text-white"
                    : "text-white/80 hover:bg-white/15 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <a
            href={SITE_URLS.velshop}
            className="hidden items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-white/90 lg:inline-flex"
          >
            เข้าช้อปปิ้ง
            <ArrowUpRight className="size-4" />
          </a>

          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="size-10 rounded-lg text-white hover:bg-white/15 hover:text-white lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>

        {open && (
          <div className="border-t border-white/15 bg-brand px-4 pb-4 pt-2 lg:hidden">
            <nav className="flex flex-col gap-1" aria-label="เมนูหลัก (มือถือ)">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive(item)
                      ? "bg-white/20 text-white"
                      : "text-white/80 hover:bg-white/15 hover:text-white",
                  )}
                >
                  {item.label}
                </Link>
              ))}
              <a
                href={SITE_URLS.velshop}
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand"
              >
                เข้าช้อปปิ้ง
                <ArrowUpRight className="size-4" />
              </a>
            </nav>
          </div>
        )}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="border-t border-border/70 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-1">
              <Logo />
              <p className="mt-4 max-w-xs text-sm leading-6 text-slate-500">
                ซื้อขายของจริง ทั้งปลีกและส่ง — ระบบนิเวศคอมเมิร์ซที่เชื่อมลูกค้า ร้านค้าชุมชน และผู้ขายไว้ในที่เดียว
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">เว็บไซต์ของ Velnox</p>
              <ul className="mt-4 space-y-2.5">
                <li><FooterLink to={SITE_URLS.velshop} external>VelShop — สำหรับลูกค้า</FooterLink></li>
                <li><FooterLink to={SITE_URLS.velseller} external>VelSeller — สำหรับร้านค้า</FooterLink></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">บริษัท</p>
              <ul className="mt-4 space-y-2.5">
                <li><FooterLink to="/about">เกี่ยวกับ</FooterLink></li>
                <li><FooterLink to="/vision">วิสัยทัศน์</FooterLink></li>
                <li><FooterLink to="/business">ธุรกิจ</FooterLink></li>
                <li><FooterLink to="/technology">เทคโนโลยี</FooterLink></li>
                <li><FooterLink to="/careers">ร่วมงานกับเรา</FooterLink></li>
                <li><FooterLink to="/news">ข่าวสาร</FooterLink></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">กฎและนโยบาย</p>
              <ul className="mt-4 space-y-2.5">
                <li><FooterLink to="/contact">ติดต่อเรา</FooterLink></li>
                <li><FooterLink to="/privacy">นโยบายความเป็นส่วนตัว</FooterLink></li>
                <li><FooterLink to="/terms">ข้อกำหนดการใช้งาน</FooterLink></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">© 2026 Velnox Group. สงวนลิขสิทธิ์</p>
            <p className="text-xs text-slate-400">ซื้อขายจริง ปลีกและส่ง · Velnox</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
