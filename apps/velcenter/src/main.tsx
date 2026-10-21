import { Toaster } from "@velnox/shared/components/ui/sonner";
import { OrderShipDialogHost } from "@/components/OrderShipDialog";
import { RequireRole } from "@velnox/shared/components/RequireRole";
import {
  RootErrorBoundary,
  RouteSyncer,
  SiteSuspense,
} from "@velnox/shared/lib/app-shell";
import { CUSTOMER_MEMORY_ENABLED } from "@velnox/shared/lib/features";
import { siteBasename } from "@velnox/shared/lib/sites";
import { IdentityMerge } from "@velnox/shared/lib/track";
import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "../../../packages/shared/src/index.css";
import { initMonitoring } from "@velnox/shared/lib/monitoring";
import { isMvpMode } from "@velnox/shared/mvp";

initMonitoring();

const Center = lazy(() => import("@/pages/Center"));
const AuthPage = lazy(() => import("@velnox/shared/pages/Auth"));
const NotFound = lazy(() => import("@velnox/shared/pages/NotFound"));
/**
 * MVP admin console (`/api/mvp`, staging/dev only). Mounted only when
 * `isMvpMode()` is true; a production build always takes the legacy tree below.
 */
const MvpAdminApp = lazy(() => import("@/mvp/App"));
const MVP_API = isMvpMode();

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    {/* PARKED (2026-10-14): Customer Memory is off, so the guest → account
        identity merge is not mounted. velShop guards the same mount; the
        component stays in source and the flag restores it. */}
    {CUSTOMER_MEMORY_ENABLED && <IdentityMerge />}
    <BrowserRouter basename={siteBasename("velcenter")}>
      <RouteSyncer />
      {MVP_API ? (
        <SiteSuspense>
          <MvpAdminApp />
        </SiteSuspense>
      ) : (
      <div className="site-app">
      <SiteSuspense>
        <Routes>
          <Route
            path="/"
            element={
              <RequireRole role="center">
                <Center />
              </RequireRole>
            }
          />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </SiteSuspense>
      </div>
      )}
    </BrowserRouter>
    {/* The fulfilment ship dialog: `packing → shipped` needs a carrier + tracking
        number, and the orders table cannot own the dialog (see the component). */}
    <OrderShipDialogHost />
    <Toaster />
  </RootErrorBoundary>,
);
