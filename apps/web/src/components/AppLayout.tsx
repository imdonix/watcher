import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BellOff,
  BellRing,
  ChevronRight,
  LayoutList,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  Settings2,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { Brand } from "@/components/Brand";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scrapePercent, scrapePhaseLine, scrapePhaseSub } from "@/lib/scrape";
import { readNewCount, subscribeNewCount } from "@/lib/inbox";
import { PUSH_STATE_EVENT } from "@/lib/push-events";

const primaryNav = [
  {
    to: "/listings",
    label: "Listings",
    icon: LayoutList,
    match: /^\/listings/
  },
  {
    to: "/routines",
    label: "Routines",
    icon: Settings2,
    match: /^\/routines/
  },
  {
    to: "/status",
    label: "Status",
    icon: Activity,
    match: /^\/status/
  },
] as const;

const settingsNav = {
  to: "/settings",
  label: "Settings",
  icon: Settings,
  match: /^\/settings/
} as const;

const mobileNav = [...primaryNav, settingsNav];

function SidebarLink({
  to,
  label,
  icon: Icon,
  active,
  badge = 0,
  onClick,
}: {
  to: string;
  label: string;
  icon: typeof LayoutList;
  active: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge > 0 ? (
        <span className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : (
        active && <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      )}
    </NavLink>
  );
}

function ScrapeProgressCard({
  active,
  progress,
  pending,
  onOpenStatus,
  onScrape,
  className,
}: {
  active: boolean;
  progress: ScrapeProgress | null;
  pending: boolean;
  onOpenStatus: () => void;
  onScrape: () => void;
  className?: string;
}) {
  const percent = scrapePercent(progress);

  if (!active) {
    return (
      <Button className={cn("w-full", className)} onClick={onScrape} disabled={pending}>
        <RefreshCw />
        Run scrape
      </Button>
    );
  }

  return (
    <div className={cn("rounded-lg border border-amber-500/30 bg-amber-500/8 p-3", className)}>
      <div className="flex items-center gap-2">
        <RefreshCw className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {scrapePhaseLine(progress)}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">
          live
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {scrapePhaseSub(progress)}
      </p>
      {percent != null && <Progress value={percent} className="mt-2 h-1 bg-amber-500/20 [&>div]:bg-amber-500" />}
      <button
        type="button"
        onClick={onOpenStatus}
        className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-800 hover:underline dark:text-amber-300"
      >
        Open status
        <ChevronRight className="size-3" />
      </button>
    </div>
  );
}

function PushSwitch({
  supported,
  pushOn,
  busy,
  onChange,
}: {
  supported: boolean;
  pushOn: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          {pushOn ? <BellRing className="size-4" /> : <BellOff className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-none">Push notifications</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {supported ? (pushOn ? "On for this device" : "Off for this device") : "Not supported"}
          </p>
        </div>
      </div>
      <Switch
        checked={pushOn}
        disabled={!supported || busy}
        onCheckedChange={() => onChange()}
        aria-label="Toggle push notifications"
      />
    </div>
  );
}

function ThemeSwitch() {
  const { theme, toggle } = useTheme();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-none">Dark mode</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {theme === "dark" ? "Dark theme active" : "Light theme active"}
          </p>
        </div>
      </div>
      <Switch
        checked={theme === "dark"}
        onCheckedChange={() => toggle()}
        aria-label="Toggle dark mode"
      />
    </div>
  );
}

export function AppLayout() {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const [scrapeRequest, setScrapeRequest] = useState(false);
  const [scrapeState, setScrapeState] = useState<{
    inProgress: boolean;
    progress: ScrapeProgress | null;
  }>({ inProgress: false, progress: null });
  const scrapeActive = scrapeRequest || scrapeState.inProgress;

  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [scraperUp, setScraperUp] = useState<boolean | null>(null);
  const [inboxCount, setInboxCount] = useState(readNewCount);

  useEffect(() => subscribeNewCount(setInboxCount), []);

  const pushSupported = isPushSupported();

  useEffect(() => {
    api
      .health()
      .then((h) => setScraperUp(h.scraper))
      .catch(() => setScraperUp(null));
    const t = setInterval(() => {
      api
        .health()
        .then((h) => setScraperUp(h.scraper))
        .catch(() => setScraperUp(null));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pushSupported) return;
    const sync = () => {
      void (async () => {
        const perm = await getNotificationPermission();
        const sub = await getExistingSubscription();
        setPushOn(perm === "granted" && Boolean(sub));
      })();
    };
    sync();
    window.addEventListener(PUSH_STATE_EVENT, sync);
    return () => window.removeEventListener(PUSH_STATE_EVENT, sync);
  }, [pushSupported]);

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

  const openStatus = () => {
    setMenuOpen(false);
    navigate("/status");
  };

  async function doScrap() {
    setScrapeRequest(true);
    try {
      const res = await api.scrap();
      if (res.alreadyRunning) {
        toast.message("Scrape already running");
        setScrapeState((s) => ({ ...s, inProgress: true }));
      } else if (res.started) {
        toast.success("Scrape started");
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

  const activePath = useMemo(() => location.pathname, [location.pathname]);

  const healthDot = (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        scraperUp === true
          ? "bg-emerald-500"
          : scraperUp === false
            ? "bg-amber-500"
            : "bg-muted-foreground/40",
      )}
      aria-hidden
    />
  );

  return (
    <div className="app-backdrop min-h-dvh">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl lg:flex">
        <div className="flex h-16 items-center px-5">
          <NavLink to="/listings" aria-label="Watcher home">
            <Brand tagline />
          </NavLink>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-3" aria-label="Primary">
          <div className="space-y-0.5">
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Workspace
            </p>
            {primaryNav.map(({ to, label, icon, match }) => (
              <SidebarLink
                key={to}
                to={to}
                label={label}
                icon={icon}
                badge={to === "/listings" ? inboxCount : 0}
                active={match.test(activePath)}
              />
            ))}
          </div>
          <div className="space-y-0.5">
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              System
            </p>
            <SidebarLink
              to={settingsNav.to}
              label={settingsNav.label}
              icon={settingsNav.icon}
              active={settingsNav.match.test(activePath)}
            />
          </div>
        </nav>

        <div className="space-y-3 border-t border-sidebar-border p-3">
          <ScrapeProgressCard
            active={scrapeActive}
            progress={scrapeState.progress}
            pending={scrapeRequest && !scrapeState.inProgress}
            onOpenStatus={openStatus}
            onScrape={() => void doScrap()}
          />
          <div className="flex items-center justify-between gap-1 px-0.5">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {healthDot}
              <span className="truncate">
                Scraper {scraperUp === true ? "up" : scraperUp === false ? "down" : "unknown"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              {pushSupported && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={pushBusy}
                      onClick={() => void togglePush()}
                      aria-label={pushOn ? "Disable push notifications" : "Enable push notifications"}
                    >
                      {pushOn ? <BellRing /> : <BellOff />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{pushOn ? "Push is on" : "Enable push"}</TooltipContent>
                </Tooltip>
              )}
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Account menu">
                    <UserRound />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-medium text-foreground">API session</p>
                    <p className="text-xs text-muted-foreground">Signed in</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/settings")}>
                    <Settings />
                    Settings
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
        </div>
      </aside>

      {/* ── Mobile top bar ─────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-14 items-center gap-2 px-3.5 sm:px-4">
          <NavLink to="/listings" className="min-w-0" aria-label="Watcher home">
            <Brand />
          </NavLink>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {scrapeActive ? (
              <button
                type="button"
                onClick={openStatus}
                className="flex h-9 max-w-[9.5rem] items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-500/15 dark:text-amber-200"
                aria-label="Scrape in progress — open Status"
              >
                <RefreshCw className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
                <span className="truncate">
                  {scrapeRequest && !scrapeState.inProgress
                    ? "Starting…"
                    : scrapePhaseLine(scrapeState.progress)}
                </span>
              </button>
            ) : (
              <Button
                size="sm"
                className="h-9 rounded-full px-3"
                onClick={() => void doScrap()}
                disabled={scrapeRequest}
                aria-label="Run scrape now"
              >
                <RefreshCw />
                <span>Scrape</span>
              </Button>
            )}

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" aria-label="Open menu">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[min(20.5rem,85vw)] gap-0 p-0 sm:max-w-sm">
                <SheetHeader className="pr-14">
                  <SheetTitle className="sr-only">Menu</SheetTitle>
                  <SheetDescription className="sr-only">
                    Navigation, scrape controls and app settings
                  </SheetDescription>
                  <Brand tagline />
                </SheetHeader>

                <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
                  <nav className="space-y-0.5" aria-label="Primary">
                    {mobileNav.map(({ to, label, icon, match }) => (
                      <SidebarLink
                        key={to}
                        to={to}
                        label={label}
                        icon={icon}
                        badge={to === "/listings" ? inboxCount : 0}
                        active={match.test(activePath)}
                        onClick={() => setMenuOpen(false)}
                      />
                    ))}
                  </nav>

                  <Separator />

                  <div className="space-y-2">
                    <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                      Scraper
                    </p>
                    <ScrapeProgressCard
                      active={scrapeActive}
                      progress={scrapeState.progress}
                      pending={scrapeRequest && !scrapeState.inProgress}
                      onOpenStatus={openStatus}
                      onScrape={() => void doScrap()}
                    />
                    <button
                      type="button"
                      onClick={openStatus}
                      className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span className="flex items-center gap-2">
                        <Activity className="size-3.5" />
                        Scrape history &amp; services
                      </span>
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>

                  <Separator />

                  <PushSwitch
                    supported={pushSupported}
                    pushOn={pushOn}
                    busy={pushBusy}
                    onChange={() => void togglePush()}
                  />
                  <ThemeSwitch />
                </div>

                <SheetFooter className="gap-2">
                  <div className="flex items-center gap-1.5 pb-1 text-[11px] text-muted-foreground">
                    {healthDot}
                    Scraper {scraperUp === true ? "up" : scraperUp === false ? "down" : "unknown"}
                  </div>
                  <Button
                    variant="outline"
                    className="justify-start text-destructive hover:text-destructive"
                    onClick={() => logout()}
                  >
                    <LogOut />
                    Log out
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* ── Page shell ─────────────────────────────────────────────────── */}
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-3.5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* ── Mobile bottom nav ──────────────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/90 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {mobileNav.map(({ to, label, icon: Icon, match }) => {
            const active = match.test(activePath);
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "relative flex min-h-[3.5rem] flex-1 touch-manipulation flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground active:bg-muted/50",
                )}
              >
                {active && (
                  <span className="absolute top-0 h-0.5 w-7 rounded-full bg-primary" aria-hidden />
                )}
                <span className="relative">
                  <Icon className={cn("size-[1.15rem]", active && "stroke-[2.4px]")} />
                  {to === "/listings" && inboxCount > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">
                      {inboxCount > 9 ? "9+" : inboxCount}
                    </span>
                  )}
                </span>
                {label}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
