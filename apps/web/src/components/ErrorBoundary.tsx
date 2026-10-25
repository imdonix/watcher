import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence against a blank screen: without an error boundary a
 * render error unmounts the whole tree and leaves the page background (white
 * in light mode, black in dark mode) with nothing on it — which is very hard
 * to recover from inside a standalone PWA on iOS, as there is no address bar
 * to reload from.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] uncaught render error", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetCachesAndReload = async () => {
    try {
      sessionStorage.removeItem("watcher_asset_recovery");
    } catch {
      /* storage unavailable */
    }
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (err) {
      console.warn("[app] cache reset failed", err);
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Watcher hit an unexpected error. Reload the app to continue.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={this.reload}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => void this.resetCachesAndReload()}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            Clear cache &amp; reload
          </button>
        </div>
        {import.meta.env.DEV && (
          <pre className="mt-2 max-w-full overflow-auto rounded-xl bg-muted p-3 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
        )}
      </div>
    );
  }
}
