import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  Ban,
  ExternalLink,
  EyeOff,
  Image as ImageIcon,
  LayoutList,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { ItemView } from "@watcher/shared";
import { formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { aiScoreVariant } from "@/lib/ai";
import { formatEngine, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ListingSkeleton } from "@/components/Skeleton";

function priceLabel(item: ItemView): string {
  if (typeof item.priceFormatted === "string") return item.priceFormatted;
  return formatPrice(item.price as number | string | null);
}

/** Lower is a better deal. Items without a signal sort last. */
function dealRank(item: ItemView): number {
  const deal = item.deal;
  if (!deal) return Number.POSITIVE_INFINITY;
  if (deal.market) {
    return deal.market.deltaPct + (deal.allTimeLow ? -15 : 0);
  }
  if (deal.allTimeLow) return -15;
  return Number.POSITIVE_INFINITY;
}

function hasDealSignal(item: ItemView): boolean {
  return Boolean(item.deal && (item.deal.market || item.deal.allTimeLow));
}

/** Swipe distance before release that dismisses a row. */
const SWIPE_DISMISS_PX = 88;
const SWIPE_MAX_PX = 140;
/** Ignore the synthetic click that follows a swipe. */
const SWIPE_CLICK_GUARD_MS = 450;

export function ListingsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemView[]>([]);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [bestDeals, setBestDeals] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [passThreshold, setPassThreshold] = useState(65);
  const [swipe, setSwipe] = useState<{ id: string; x: number } | null>(null);
  /** Pending per-row exit-animation timers (id → timeout handle). */
  const flipTimers = useRef(new Map<string, number>());
  const swipeRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    engaged: boolean;
  } | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const clickGuardTimer = useRef<number | null>(null);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (opts?.soft) setRefreshing(true);
    else setLoading(true);
    try {
      setItems(await api.items(300, "all"));
      void api
        .settings()
        .then((s) => setPassThreshold(Number(s.aiPassThreshold) || 65))
        .catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load listings");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      for (const t of flipTimers.current.values()) window.clearTimeout(t);
      flipTimers.current.clear();
      if (clickGuardTimer.current != null) window.clearTimeout(clickGuardTimer.current);
    },
    [],
  );

  /** Potential products only — AI rejects and manual dismissals are excluded. */
  const active = useMemo(
    () => items.filter((i) => i.status === "active" && !i.notInterested),
    [items],
  );
  const hidden = useMemo(() => items.filter((i) => i.notInterested), [items]);
  const source = showHidden ? hidden : active;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? source.filter(
          (i) =>
            String(i.name).toLowerCase().includes(q) ||
            String(i.engineSlug ?? "").toLowerCase().includes(q),
        )
      : source;
    return [...matching].sort((a, b) => {
      if (bestDeals) {
        const rankA = dealRank(a);
        const rankB = dealRank(b);
        if (rankA !== rankB) return rankA - rankB;
      }
      return (
        new Date(String(b.firstSeenAt)).getTime() -
        new Date(String(a.firstSeenAt)).getTime()
      );
    });
  }, [source, query, bestDeals]);

  const dealSignals = useMemo(() => active.filter(hasDealSignal).length, [active]);

  function openDetails(id: string) {
    navigate(`/listings/${encodeURIComponent(id)}`);
  }

  function patchItem(id: string, patch: Partial<ItemView>) {
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function clearExiting(id: string) {
    setExiting((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function flipAfterExit(id: string, patch: Partial<ItemView>, startedAt: number, delayMs = 220) {
    const existing = flipTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    const wait = Math.max(0, delayMs - (Date.now() - startedAt));
    flipTimers.current.set(
      id,
      window.setTimeout(() => {
        flipTimers.current.delete(id);
        patchItem(id, patch);
        clearExiting(id);
      }, wait),
    );
  }

  function cancelFlip(id: string) {
    const existing = flipTimers.current.get(id);
    if (existing) {
      window.clearTimeout(existing);
      flipTimers.current.delete(id);
    }
  }

  function suppressNextClick(id: string) {
    suppressClickRef.current = id;
    if (clickGuardTimer.current != null) window.clearTimeout(clickGuardTimer.current);
    clickGuardTimer.current = window.setTimeout(() => {
      suppressClickRef.current = null;
      clickGuardTimer.current = null;
    }, SWIPE_CLICK_GUARD_MS);
  }

  function swipeStart(item: ItemView, e: ReactPointerEvent<HTMLLIElement>) {
    if (e.pointerType === "mouse" || showHidden || item.notInterested) return;
    if (busyId === item.id || exiting.has(item.id)) return;
    if (!e.isPrimary) return;
    swipeRef.current = {
      id: item.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: 0,
      engaged: false,
    };
  }

  function swipeMove(e: ReactPointerEvent<HTMLLIElement>) {
    const s = swipeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    if (!s.engaged) {
      // Let vertical scrolling win until the gesture is clearly horizontal.
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        swipeRef.current = null;
        setSwipe(null);
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      if (dx > 0) {
        swipeRef.current = null;
        setSwipe(null);
        return;
      }
      s.engaged = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
    }

    e.preventDefault();
    const x = Math.max(-SWIPE_MAX_PX, Math.min(0, dx));
    s.x = x;
    setSwipe({ id: s.id, x });
  }

  function swipeEnd(
    item: ItemView,
    e: ReactPointerEvent<HTMLLIElement>,
    cancelled = false,
  ) {
    const s = swipeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    swipeRef.current = null;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }

    if (!s.engaged) {
      setSwipe(null);
      return;
    }

    suppressNextClick(item.id);

    if (!cancelled && s.x <= -SWIPE_DISMISS_PX) {
      setSwipe(null);
      void dismiss(item);
      return;
    }

    // Below the threshold — spring back.
    setSwipe({ id: item.id, x: 0 });
    window.setTimeout(() => {
      setSwipe((prev) => (prev?.id === item.id && prev.x === 0 ? null : prev));
    }, 180);
  }

  function suppressSwipeClick(item: ItemView, e: ReactMouseEvent<HTMLLIElement>) {
    if (suppressClickRef.current !== item.id) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = null;
  }

  async function dismiss(item: ItemView) {
    if (busyId || exiting.has(item.id)) return;
    setBusyId(item.id);

    const started = Date.now();
    setExiting((prev) => new Set(prev).add(item.id));

    try {
      await api.setNotInterested(item.id, true);
      flipAfterExit(
        item.id,
        {
          notInterested: true,
          notInterestedAt: new Date().toISOString(),
          available: false,
        },
        started,
      );
      toast("Hidden", {
        description: "Find it under Hidden",
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              try {
                cancelFlip(item.id);
                await api.setNotInterested(item.id, false);
                await load({ soft: true });
              } catch {
                toast.error("Could not undo");
              }
            })();
          },
        },
      });
    } catch (err) {
      clearExiting(item.id);
      toast.error(err instanceof Error ? err.message : "Update failed");
      await load({ soft: true });
    } finally {
      setBusyId(null);
    }
  }

  async function restore(item: ItemView) {
    if (busyId || exiting.has(item.id)) return;
    setBusyId(item.id);
    const started = Date.now();
    setExiting((prev) => new Set(prev).add(item.id));
    try {
      await api.setNotInterested(item.id, false);
      flipAfterExit(
        item.id,
        { notInterested: false, notInterestedAt: null, available: item.status === "active" },
        started,
      );
      toast.success("Back in potential products");
    } catch (err) {
      clearExiting(item.id);
      toast.error(err instanceof Error ? err.message : "Update failed");
      await load({ soft: true });
    } finally {
      setBusyId(null);
    }
  }

  function switchView(hiddenView: boolean) {
    setShowHidden(hiddenView);
    setQuery("");
    setSwipe(null);
    if (hiddenView) setBestDeals(false);
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Listings"
          description="Loading potential products…"
        />
        <ListingSkeleton count={5} />
      </div>
    );
  }

  const filtered = query.trim().length > 0;

  const emptyState = filtered ? (
    <EmptyState
      icon={<Search className="size-5" />}
      title="No matches"
      description={`Nothing matches “${query.trim()}” in ${
        showHidden ? "hidden listings" : "potential products"
      }.`}
      action={
        <Button variant="outline" size="sm" onClick={() => setQuery("")}>
          Clear search
        </Button>
      }
    />
  ) : showHidden ? (
    <EmptyState
      icon={<EyeOff className="size-5" />}
      title="Nothing hidden"
      description="Listings the AI rejects or you dismiss are collected here so you can restore them."
      action={
        <Button variant="outline" size="sm" onClick={() => switchView(false)}>
          Back to potential products
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<LayoutList className="size-5" />}
      title="No potential products"
      description="New finds from the next scrape will show up here. Listings the AI decides are not a match are hidden automatically."
      action={
        <Button variant="outline" size="sm" onClick={() => void load({ soft: true })}>
          <RefreshCw className={cn(refreshing && "animate-spin")} />
          Refresh
        </Button>
      }
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={showHidden ? "Hidden listings" : "Listings"}
        description={
          showHidden
            ? "Hidden listings — restore anything the AI got wrong."
            : `${active.length} potential product${active.length === 1 ? "" : "s"}, newest first. AI rejects are hidden automatically.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!showHidden && (
              <Button variant="ghost" size="sm" onClick={() => switchView(true)}>
                <EyeOff />
                Hidden
              </Button>
            )}
            {!showHidden && dealSignals > 0 && (
              <Button
                variant={bestDeals ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBestDeals((v) => !v)}
                aria-pressed={bestDeals}
              >
                <ArrowDownWideNarrow />
                Best deals
              </Button>
            )}
            {showHidden && (
              <Button variant="secondary" size="sm" onClick={() => switchView(false)}>
                <ArrowLeft />
                Potential
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ soft: true })}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {source.length > 0 && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={showHidden ? "Search hidden listings…" : "Search potential products…"}
            aria-label={showHidden ? "Search hidden listings" : "Search potential products"}
            className="h-9 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        emptyState
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y divide-border/70">
            {visible.map((item) => {
              const leaving = exiting.has(item.id);
              const imgBroken = brokenImages.has(item.id);
              const dropped =
                typeof item.prevPrice === "number" &&
                typeof item.price === "number" &&
                item.prevPrice > item.price
                  ? item.prevPrice - item.price
                  : null;
              const market = item.deal?.market;
              const showMarket = Boolean(
                market && Math.abs(market.deltaPct) >= 5,
              );
              const swiping = swipe?.id === item.id;
              const swipeX = swiping ? swipe.x : 0;
              const swipeProgress = Math.min(
                1,
                Math.abs(swipeX) / SWIPE_DISMISS_PX,
              );
              const detailLink = `/listings/${encodeURIComponent(item.id)}`;

              return (
                <li
                  key={item.id}
                  className={cn(
                    "group relative overflow-hidden transition-all duration-200 ease-out",
                    leaving && "pointer-events-none -translate-x-2 scale-[0.99] opacity-0",
                  )}
                  onPointerDown={(e) => swipeStart(item, e)}
                  onPointerMove={swipeMove}
                  onPointerUp={(e) => swipeEnd(item, e)}
                  onPointerCancel={(e) => swipeEnd(item, e, true)}
                  onClickCapture={(e) => suppressSwipeClick(item, e)}
                >
                  <div
                    className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1.5 pr-4 text-destructive"
                    style={{ opacity: swipeProgress }}
                    aria-hidden
                  >
                    <Ban className="size-4" />
                    <span className="text-xs font-medium">Not interested</span>
                  </div>

                  <div
                    className={cn(
                      "relative flex gap-3 bg-card p-3 group-hover:bg-muted/35 sm:gap-4 sm:p-4",
                      !swiping && "transition-transform duration-200 ease-out",
                    )}
                    style={{
                      touchAction: "pan-y",
                      transform: swipeX ? `translateX(${swipeX}px)` : undefined,
                    }}
                  >
                    <div className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-muted sm:size-24">
                      {item.image && !imgBroken ? (
                        <img
                          src={String(item.image)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          onError={() =>
                            setBrokenImages((prev) => new Set(prev).add(item.id))
                          }
                        />
                      ) : (
                        <div className="grid size-full place-items-center text-muted-foreground/40">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-[14px] font-medium leading-snug tracking-tight text-foreground sm:text-[15px]">
                            <Link
                              to={detailLink}
                              className="cursor-pointer rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
                            >
                              {String(item.name)}
                            </Link>
                          </h3>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[15px] font-semibold tabular-nums leading-tight tracking-tight text-primary sm:text-base">
                            {priceLabel(item)}
                          </p>
                          {dropped != null && (
                            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground line-through">
                              {formatPrice(item.prevPrice as number)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {showHidden && (
                          <Badge variant="secondary">
                            {item.notInterestedReason === "ai" ? "Hidden by AI" : "Hidden"}
                          </Badge>
                        )}
                        {item.deal?.allTimeLow ? (
                          <Badge
                            variant="success"
                            title={
                              item.deal.lowestPrice != null
                                ? `Lowest observed price: ${formatPrice(item.deal.lowestPrice)}`
                                : "Lowest price observed"
                            }
                          >
                            <TrendingDown className="size-3" />
                            All-time low
                          </Badge>
                        ) : dropped != null ? (
                          <Badge variant="success">
                            <TrendingDown className="size-3" />-{formatPrice(dropped)}
                          </Badge>
                        ) : null}
                        {market && showMarket && (
                          <Badge
                            variant={
                              market.deltaPct <= -10
                                ? "success"
                                : market.deltaPct >= 10
                                  ? "warning"
                                  : "secondary"
                            }
                            title={`Shop ${formatPrice(market.shopPrice)} on Árukereső · ${market.sampleSize} offer${
                              market.sampleSize === 1 ? "" : "s"
                            }`}
                          >
                            {market.deltaPct > 0 ? (
                              <TrendingUp className="size-3" />
                            ) : (
                              <TrendingDown className="size-3" />
                            )}
                            {market.deltaPct > 0 ? "+" : ""}
                            {market.deltaPct}% vs shop
                          </Badge>
                        )}
                        {typeof item.aiScore === "number" ? (
                          <Badge
                            variant={aiScoreVariant(item.aiScore, passThreshold)}
                            title={
                              item.aiReason
                                ? `AI score ${item.aiScore}: ${item.aiReason}`
                                : `AI score ${item.aiScore}`
                            }
                          >
                            <Sparkles className="size-3" />
                            {item.aiScore}
                          </Badge>
                        ) : item.aiVerdict ? (
                          <Badge
                            variant={item.aiVerdict === "pass" ? "success" : "destructive"}
                            title={item.aiReason ?? "AI evaluation"}
                          >
                            AI {item.aiVerdict}
                          </Badge>
                        ) : null}
                        {item.engineSlug && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {formatEngine(item.engineSlug)}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-auto flex items-end justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          First seen {formatRelative(item.firstSeenAt)}
                        </p>
                        <div className="relative z-10 flex shrink-0 items-center gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                asChild
                              >
                                <a
                                  href={String(item.url ?? "#")}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Open original listing"
                                >
                                  <ExternalLink />
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open original</TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                aria-label="Listing actions"
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onSelect={() => openDetails(item.id)}>
                                <LayoutList />
                                View details
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <a href={String(item.url ?? "#")} target="_blank" rel="noreferrer">
                                  <ExternalLink />
                                  Open original
                                </a>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {item.notInterested ? (
                                <DropdownMenuItem
                                  disabled={busyId === item.id}
                                  onSelect={() => void restore(item)}
                                >
                                  <RotateCcw />
                                  Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  destructive
                                  disabled={busyId === item.id}
                                  onSelect={() => void dismiss(item)}
                                >
                                  <Ban />
                                  Not interested
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
