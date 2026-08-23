import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { I18nProvider } from "@velnox/i18n";
import "./index.css";

import Landing from "./pages/Landing";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>
);
