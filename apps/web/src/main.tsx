import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Toaster } from "sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { App } from "./App";
import "./index.css";

/**
 * Auto-update PWA:
 * - poll for new SW often
 * - when a new SW takes control, reload so UI matches the new build
 * (avoids needing a manual cache clear after deploys)
 */
let reloading = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Activate waiting worker immediately (registerType: autoUpdate)
    void updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;

    const check = () => {
      void registration.update();
    };

    // Check every minute + when tab is focused again
    setInterval(check, 60_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("focus", check);

    // First check shortly after load
    setTimeout(check, 5_000);
  },
  onRegisterError(error) {
    console.warn("[PWA] service worker registration failed", error);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          richColors
          position="top-center"
          closeButton
          toastOptions={{
            className: "rounded-xl",
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
