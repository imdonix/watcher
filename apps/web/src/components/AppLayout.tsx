import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BellOff,
  BellRing,
  LayoutList,
  LogOut,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Settings2,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ScrapeProgress } from "@watcher/shared";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import {
  disablePushNotifications,
  enablePushNotifications,
  getExistingSubscription,
  getNotificationPermission,
  isPushSupported,
} from "@/lib/push";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/listings", label: "Listings", icon: LayoutList, match: /^\/listings/ },
  { to: "/routines", label: "Routines", icon: Settings2, match: /^\/routines/ },
  { to: "/status", label: "Status", icon: Activity, match: /^\/status/ },
] as const;

/** Short line 1 for the in-progress chip (counters where available). */
function scrapePhaseLine(p: ScrapeProgress | null): string {
  if (!p) return "Starting…";
  switch (p.phase) {
    case "routine":
      return p.routineIndex != null && p.routinesTotal != null
        ? `Routine ${p.routineIndex}/${p.routinesTotal}`
        : "Scraping listings";
    case "details":
      return p.detailsTotal != null && p.detailsTotal > 0
        ? `Details ${p.detailsIndex ?? 0}/${p.detailsTotal}`
        : "Item details…";
    case "ai":
      return p.detailsTotal != null && p.detailsTotal > 0
        ? `AI ${p.detailsIndex ?? 0}/${p.detailsTotal}`
        : "AI evaluation…";
    case "finishing":
      return "Finishing up";
    case "notify":
      return "Sending notifications";
    case "starting":
      return "Starting…";
    default:
      return "Scraping…";
  }
}

/** Line 2 for the chip — context without repeating line 1. */
function scrapePhaseSub(p: ScrapeProgress | null): string {
  if (!p) return "Scrape requested";
  if (p.phase === "routine") return p.engineName ?? p.message;
  if (p.phase === "details" || p.phase === "ai") {
    return p.routineLabel ?? p.message;
  }
  return p.message;
}

export function AppLayout() {
  const { logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isDetail = /^\/listings\/.+/.test(location.pathname);
  const onSettings = location.pathname.startsWith("/settings");

  const [scrapeRequest, setScrapeRequest] = useState(false);
  const [scrapeState, setScrapeState] = useState<{
    inProgress: boolean;
    progress: ScrapeProgress | null;
  }>({ inProgress: false, progress: null });
  const scrapeActive = scrapeRequest || scrapeState.inProgress;
  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [scraperUp, setScraperUp] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setScraperUp(h.scraper))
      .catch(() => setScraperUp(null));
    void (async () => {
      if (!isPushSupported()) return;
      const perm = await getNotificationPermission();
      const sub = await getExistingSubscription();
      setPushOn(perm === "granted" && Boolean(sub));
    })();
  }, []);

  // Poll scrape state — fast while running (live counters), slow when idle.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await api.scrapeStatus();
        if (!cancelled) setScrapeState(s);
      } catch {
        /* transient — keep last known state */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), scrapeActive ? 1200 : 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [scrapeActive]);

  async function doScrap() {
    setScrapeRequest(true);
    try {
      const res = await api.scrap();
      if (res.alreadyRunning) {
        toast.message("Scrape already running");
        setScrapeState((s) => ({ ...s, inProgress: true }));
      } else if (res.started) {
        toast.success("Scrape started — progress shows here");
        setScrapeState((s) => ({ ...s, inProgress: true }));
      } else {
        toast.message(res.message ?? "Scrape requested");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start scrape");
    } finally {
      setScrapeRequest(false);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePushNotifications();
        setPushOn(false);
        toast.message("Push notifications off");
      } else {
        await enablePushNotifications();
        setPushOn(true);
        toast.success("Push notifications on");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push setup failed");
    } finally {
      setPushBusy(false);
    }
  }

  const themeButton = (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
    </Button>
  );

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border/60 bg-card/60 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center px-4">
          <NavLink
            to="/listings"
            className="truncate text-[15px] font-semibold tracking-tight transition-colors hover:text-primary"
          >
            Watcher
          </NavLink>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Primary">
          {nav.map(({ to, label, icon: Icon, match }) => {
            const active = match.test(location.pathname);
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4.5 w-4.5", active && "text-primary")} />
                {label}
              </NavLink>
            );
          })}
          <NavLink
            to="/settings"
            className={cn(
              "mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              onSettings
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Settings className={cn("h-4.5 w-4.5", onSettings && "text-primary")} />
            Settings
          </NavLink>
        </nav>

        <div className="space-y-2 border-t border-border/60 p-3">
          {scrapeActive ? (
            <button
              type="button"
              onClick={() => navigate("/status")}
              className="flex w-full items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left transition-colors hover:bg-amber-500/20"
              aria-label="Scrape in progress — open Status"
              title="Open Status"
            >
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {scrapeRequest && !scrapeState.inProgress
                    ? "Starting…"
                    : scrapePhaseLine(scrapeState.progress)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {scrapeRequest && !scrapeState.inProgress
                    ? "Requesting scrape…"
                    : scrapePhaseSub(scrapeState.progress)}
                </span>
              </span>
            </button>
          ) : (
            <Button
              className="w-full"
              onClick={() => void doScrap()}
              disabled={scrapeRequest}
              aria-label="Run scrape now"
            >
              <RefreshCw className="h-4 w-4" />
              Scrape now
            </Button>
          )}

          <div className="flex items-center gap-1">
            {isPushSupported() && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                disabled={pushBusy}
                onClick={() => void togglePush()}
                aria-label={pushOn ? "Disable push notifications" : "Enable push notifications"}
                title={pushOn ? "Push on" : "Push off"}
              >
                {pushOn ? <BellRing className="h-4.5 w-4.5" /> : <BellOff className="h-4.5 w-4.5" />}
              </Button>
            )}
            {themeButton}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-9 w-9"
              onClick={() => logout()}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="h-4.5 w-4.5" />
            </Button>
          </div>

          <p className="flex items-center gap-1.5 truncate px-1 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                scraperUp === true ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            Scraper {scraperUp === true ? "up" : scraperUp === false ? "down" : "unknown"}
          </p>
        </div>
      </aside>

      {/* Compact sticky top bar (mobile + tablet) */}
      <header
        className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          <NavLink
            to="/listings"
            className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight transition-colors hover:text-primary"
          >
            Watcher
          </NavLink>

          <div className="flex shrink-0 items-center gap-1">
            {scrapeActive ? (
              <button
                type="button"
                onClick={() => navigate("/status")}
                className="flex h-9 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-medium transition-colors hover:bg-amber-500/20"
                aria-label="Scrape in progress — open Status"
                title="Open Status"
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
                <span className="max-w-[8.5rem] truncate">
                  {scrapeRequest && !scrapeState.inProgress
                    ? "Starting…"
                    : scrapePhaseLine(scrapeState.progress)}
                </span>
              </button>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="h-9 gap-1.5 rounded-full px-3.5 shadow-sm"
                onClick={() => void doScrap()}
                disabled={scrapeRequest}
                aria-label="Run scrape now"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Scrape</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  aria-label="More options"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Settings</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => navigate("/settings")}
                  className={cn(onSettings && "bg-accent")}
                >
                  <Settings />
                  <span className="flex-1">System settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  {theme === "dark" ? <Sun /> : <Moon />}
                  <span className="flex-1">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                </DropdownMenuItem>
                {isPushSupported() && (
                  <DropdownMenuItem
                    disabled={pushBusy}
                    onSelect={(e) => {
                      e.preventDefault();
                      void togglePush();
                    }}
                  >
                    {pushOn ? <BellRing /> : <BellOff />}
                    <span className="flex-1">{pushOn ? "Push on" : "Enable push"}</span>
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        pushOn ? "bg-emerald-500" : "bg-muted-foreground/30",
                      )}
                    />
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled className="opacity-100">
                  <Activity />
                  <span className="flex-1">Scraper</span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      scraperUp === true
                        ? "text-emerald-600"
                        : scraperUp === false
                          ? "text-amber-600"
                          : "text-muted-foreground",
                    )}
                  >
                    {scraperUp === true ? "Up" : scraperUp === false ? "Down" : "—"}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => logout()}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Page shell — offset by sidebar on desktop */}
      <div className="lg:pl-60">
        <main
          className={cn(
            "mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6",
            // room for bottom nav + safe area; less padding on detail (has its own sticky bar)
            isDetail
              ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-8"
              : "pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8",
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile + tablet) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-5xl">
          {nav.map(({ to, label, icon: Icon, match }) => {
            const active = match.test(location.pathname);
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "flex min-h-[3.5rem] flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground active:bg-muted/50",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.25px]")} />
                {label}
              </NavLink>
            );
          })}
          <NavLink
            to="/settings"
            className={cn(
              "flex min-h-[3.5rem] flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
              onSettings ? "text-primary" : "text-muted-foreground active:bg-muted/50",
            )}
          >
            <Settings className={cn("h-5 w-5", onSettings && "stroke-[2.25px]")} />
            Settings
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
