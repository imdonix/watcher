import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BellOff,
  BellRing,
  LayoutList,
  LogOut,
  MoreHorizontal,
  Radar,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
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

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/listings/") && pathname !== "/listings") return "Listing";
  if (pathname.startsWith("/listings")) return "Listings";
  if (pathname.startsWith("/routines")) return "Routines";
  if (pathname.startsWith("/status")) return "Status";
  return "Watcher";
}

export function AppLayout() {
  const { logout } = useAuth();
  const location = useLocation();
  const title = useMemo(() => pageTitle(location.pathname), [location.pathname]);
  const isDetail = /^\/listings\/.+/.test(location.pathname);

  const [scraping, setScraping] = useState(false);
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

  async function doScrap() {
    setScraping(true);
    try {
      const res = await api.scrap();
      if (res.alreadyRunning) {
        toast.message("Scrape already running");
      } else if (res.started) {
        toast.success("Scrape started — check Status for progress");
      } else {
        toast.message(res.message ?? "Scrape requested");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start scrape");
    } finally {
      // Button only reflects request in flight, not full scrape duration
      setScraping(false);
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

  return (
    <div className="min-h-dvh">
      {/* Compact sticky top bar — brand + primary action + overflow */}
      <header
        className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
              <Radar className="h-4 w-4" />
              {scraperUp === false && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-amber-500"
                  title="Scraper down"
                />
              )}
            </div>

            {/* Mobile: contextual page title. Desktop: brand + inline nav */}
            <div className="min-w-0 sm:hidden">
              <p className="truncate text-[15px] font-semibold tracking-tight">{title}</p>
            </div>
            <div className="hidden min-w-0 items-center gap-4 sm:flex">
              <span className="text-[15px] font-semibold tracking-tight">Watcher</span>
              <nav className="flex items-center gap-0.5">
                {nav.map(({ to, label, match }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={() =>
                      cn(
                        "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                        match.test(location.pathname)
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="default"
              size="sm"
              className="h-9 gap-1.5 rounded-full px-3.5 shadow-sm"
              onClick={() => void doScrap()}
              disabled={scraping}
              aria-label="Run scrape now"
            >
              <RefreshCw className={cn("h-4 w-4", scraping && "animate-spin")} />
              <span className="hidden sm:inline">{scraping ? "Scraping…" : "Scrape"}</span>
            </Button>

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

      <main
        className={cn(
          "mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6",
          // room for bottom nav + safe area; less padding on detail (has its own sticky bar)
          isDetail
            ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8"
            : "pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-8",
        )}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur-xl sm:hidden"
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
        </div>
      </nav>
    </div>
  );
}
