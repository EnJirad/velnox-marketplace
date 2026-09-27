import { Toaster } from "@velnox/shared/components/ui/sonner";
import { RequireRole } from "@velnox/shared/components/RequireRole";
import {
  RootErrorBoundary,
  RouteSyncer,
  SiteSuspense,
} from "@velnox/shared/lib/app-shell";
import { siteBasename } from "@velnox/shared/lib/sites";
import { MobileTabBar, type MobileTabItem } from "@velnox/shared/components/MobileTabBar";
import { useSellerApplication } from "@velnox/shared/hooks/use-seller-application";
import { shouldShowSellerTab } from "@velnox/shared/lib/seller-access";
import { IdentityMerge } from "@velnox/shared/lib/track";
import { RefreshCw, ShoppingBag, Store, Target, UserCircle, Wallet } from "lucide-react";
import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "../../../packages/shared/src/index.css";
import { initMonitoring } from "@velnox/shared/lib/monitoring";

/** App-like bottom navigation for mobile (velseller). */
const SELLER_TABS: MobileTabItem[] = [
  { to: "/seller/goals", label: "เป้าหมาย", icon: Target },
  { to: "/seller/shop", label: "ร้านของฉัน", icon: Store },
  { to: "/seller/orders", label: "ออเดอร์", icon: ShoppingBag },
  { to: "/seller/income", label: "รายได้", icon: Wallet },
  { to: "/seller/profile", label: "โปรไฟล์", icon: UserCircle },
];

/**
 * The seller tab bar IS a seller surface: it renders only for an approved seller
 * application. Fail closed — hidden while the status is loading, when the status
 * API fails, and for every status that is not `approved` (no application,
 * pending, under_review, needs_correction, rejected, suspended). `users.role` is
 * deliberately NOT used: it is a cached promotion, not the application's state.
 *
 * Meanwhile the gate inside <RequireRole> (which every seller route is wrapped
 * in) shows the application form / review state — that is the existing entry
 * point for applying, correcting and resubmitting.
 */
function SellerTabBar() {
  const { sellerAccess, loading, error } = useSellerApplication();
  // One shared decision: approved only, and never while loading or after an API
  // error (fail closed — see shouldShowSellerTab).
  if (!shouldShowSellerTab({ sellerAccess, loading, error })) return null;
  return <MobileTabBar items={SELLER_TABS} />;
}

initMonitoring();

const SellerGoals = lazy(() => import("@/pages/SellerGoals"));
const MyShop = lazy(() => import("@/pages/MyShop"));
const Reorder = lazy(() => import("@/pages/Reorder"));
const SellerOrders = lazy(() => import("@/pages/SellerOrders"));
const SellerChat = lazy(() => import("@/pages/SellerChat"));
const SellerProfile = lazy(() => import("@/pages/SellerProfile"));
const Income = lazy(() => import("@/pages/Income"));
const AuthPage = lazy(() => import("@velnox/shared/pages/Auth"));
const NotFound = lazy(() => import("@velnox/shared/pages/NotFound"));

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <IdentityMerge />
    <BrowserRouter basename={siteBasename("velseller")}>
      <RouteSyncer />
      <div className="site-app">
      <SiteSuspense>
        <Routes>
          <Route path="/" element={<Navigate to="/seller/goals" replace />} />
          <Route
            path="/seller/goals"
            element={
              <RequireRole role="seller">
                <SellerGoals />
              </RequireRole>
            }
          />
          <Route
            path="/seller/shop"
            element={
              <RequireRole role="seller">
                <MyShop />
              </RequireRole>
            }
          />
          <Route
            path="/seller/reorder"
            element={
              <RequireRole role="seller">
                <Reorder />
              </RequireRole>
            }
          />
          <Route
            path="/seller/orders"
            element={
              <RequireRole role="seller">
                <SellerOrders />
              </RequireRole>
            }
          />
          <Route
            path="/seller/income"
            element={
              <RequireRole role="seller">
                <Income />
              </RequireRole>
            }
          />
          <Route
            path="/seller/chat"
            element={
              <RequireRole role="seller">
                <SellerChat />
              </RequireRole>
            }
          />
          <Route
            path="/seller/profile"
            element={
              <RequireRole role="seller">
                <SellerProfile />
              </RequireRole>
            }
          />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </SiteSuspense>
      <SellerTabBar />
      </div>
    </BrowserRouter>
    <Toaster />
  </RootErrorBoundary>,
);
