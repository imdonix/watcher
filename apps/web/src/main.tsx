import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Toaster, toast } from "sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider, useTheme } from "@/hooks/use-theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./index.css";

/**
 * PWA updates are user-confirmed instead of automatic.
 *
 * Swapping the service worker + reloading the page while the user is inside
 * the app is the classic way to end up on a blank white/black screen on iOS
 * (the reload can race with a back navigation, or the new document can be
 * served from an inconsistent cache). The SW now keeps the old build alive
 * until the user taps "Reload", and navigations are network-first, so a new
 * deploy is picked up without any forced reload.
 */
let promptedForUpdate = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (promptedForUpdate) return;
    promptedForUpdate = true;
    toast("Update available", {
      id: "sw-update",
      description: "Reload to get the latest version of Watcher.",
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: {
        label: "Reload",
        onClick: () => void updateSW(true),
      },
    });
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;

    const check = () => {
      void registration.update();
    };

    // Check periodically + whenever the app comes back to the foreground.
    setInterval(check, 5 * 60_000);
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

function AppToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      richColors
      theme={theme}
      position="top-center"
      closeButton
      toastOptions={{
        className: "rounded-xl",
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
              <AppToaster />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
