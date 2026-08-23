import { Link } from "react-router";
import { ArrowRight, Shield, Truck, Star, Globe, Users, ShoppingBag, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { useI18n } from "@velnox/i18n";

const fadeUp = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } };
const stagger = { animate: { transition: { staggerChildren: 0.08 } } };

export default function Landing() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">V</div>
            <span className="text-lg font-bold tracking-tight">Velnox</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#about" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">{t("velnox.about")}</a>
            <a href="#sellers" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">{t("velnox.for_sellers")}</a>
            <a href="#contact" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">{t("velnox.contact")}</a>
          </div>
          <Link to="https://velshop.vercel.app" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            {t("velnox.visit_marketplace")}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-accent/5" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <motion.div className="max-w-3xl" initial="initial" animate="animate" variants={stagger}>
            <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] text-balance">
              {t("velnox.hero_title")} <span className="text-accent">{t("velnox.hero_highlight")}</span>
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed">
              {t("velnox.hero_description")}
            </motion.p>
            <motion.div variants={fadeUp} className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link to="https://velshop.vercel.app" className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                {t("velnox.shop_now")} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link to="https://velseller.vercel.app" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-8 py-3 text-base font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
                {t("velnox.start_selling")}
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border/40 bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: "10K+", label: t("velnox.stat_products"), icon: ShoppingBag },
              { value: "500+", label: t("velnox.stat_sellers"), icon: Users },
              { value: "50K+", label: t("velnox.stat_customers"), icon: Globe },
              { value: "99.9%", label: t("velnox.stat_uptime"), icon: Zap },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <stat.icon className="h-8 w-8 text-accent mx-auto mb-3" />
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t("velnox.about_title")}</h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">{t("velnox.about_description")}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16">
          {[
            { icon: Shield, title: t("velnox.feature_trust"), description: t("velnox.feature_trust_desc") },
            { icon: Truck, title: t("velnox.feature_delivery"), description: t("velnox.feature_delivery_desc") },
            { icon: Star, title: t("velnox.feature_quality"), description: t("velnox.feature_quality_desc") },
          ].map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border/60 p-8 text-center">
              <div className="h-12 w-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
                <feature.icon className="h-6 w-6 text-accent" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* For Sellers */}
      <section id="sellers" className="border-y border-border/40 bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t("velnox.sellers_title")}</h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">{t("velnox.sellers_description")}</p>
            <div className="mt-8">
              <Link to="https://velseller.vercel.app" className="inline-flex items-center rounded-md bg-primary px-8 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                {t("velnox.become_seller")} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t("velnox.contact_title")}</h2>
          <p className="mt-6 text-lg text-muted-foreground">{t("velnox.contact_description")}</p>
          <p className="mt-4 text-muted-foreground">support@velnox.com</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">V</div>
              <span className="text-lg font-bold tracking-tight">Velnox</span>
            </div>
            <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Velnox. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
