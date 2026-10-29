import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { MandatePage } from "./pages/Mandate";
import { RunPage } from "./pages/Run";
import { TimelinePage } from "./pages/Timeline";
import { DisputesPage } from "./pages/Disputes";
import { DisputeDetailPage } from "./pages/DisputeDetail";
import { VerifyPage } from "./pages/Verify";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/mandate" replace />} />
              <Route path="/mandate" element={<MandatePage />} />
              <Route path="/run" element={<RunPage />} />
              <Route path="/timeline/:requestId" element={<TimelinePage />} />
              <Route path="/disputes" element={<DisputesPage />} />
              <Route path="/disputes/:id" element={<DisputeDetailPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/verify/:requestId" element={<VerifyPage />} />
              <Route path="*" element={<p>Page not found.</p>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
