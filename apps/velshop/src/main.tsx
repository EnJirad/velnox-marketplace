import { Toaster } from "@velnox/shared/components/ui/sonner";
import {
  RootErrorBoundary,
  RouteSyncer,
  SiteSuspense,
} from "@velnox/shared/lib/app-shell";
import { siteBasename } from "@velnox/shared/lib/sites";
import { lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";
import "../../../packages/shared/src/index.css";

const MvpShopApp = lazy(() => import("@/mvp/App"));

/**
 * Global route scroll restoration — every page navigation (incl. back/forward)
 * starts at the top. Keyed on pathname only so in-page state changes (sheets,
 * drawers, modals, query updates) never reset scroll.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <BrowserRouter basename={siteBasename("velshop")}>
      <ScrollToTop />
      <RouteSyncer />
      <SiteSuspense>
        <MvpShopApp />
      </SiteSuspense>
    </BrowserRouter>
    <Toaster />
  </RootErrorBoundary>,
);
