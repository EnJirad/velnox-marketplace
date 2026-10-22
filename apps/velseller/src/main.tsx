import { Toaster } from "@velnox/shared/components/ui/sonner";
import {
  RootErrorBoundary,
  RouteSyncer,
  SiteSuspense,
} from "@velnox/shared/lib/app-shell";
import { siteBasename } from "@velnox/shared/lib/sites";
import { lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "../../../packages/shared/src/index.css";

const MvpSellerApp = lazy(() => import("@/mvp/App"));

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <BrowserRouter basename={siteBasename("velseller")}>
      <RouteSyncer />
      <SiteSuspense>
        <MvpSellerApp />
      </SiteSuspense>
    </BrowserRouter>
    <Toaster />
  </RootErrorBoundary>,
);
