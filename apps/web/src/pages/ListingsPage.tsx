import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpDown,
  Ban,
  Check,
  ChevronDown,
  ExternalLink,
  LayoutList,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { ItemView } from "@watcher/shared";
import { formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { aiScoreClass } from "@/lib/ai";
import { formatEngine, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/EmptyState";
import { ListingSkeleton } from "@/components/Skeleton";
import { SegmentedControl } from "@/components/SegmentedControl";
import { cn } from "@/lib/utils";

type Filter = "available" | "all" | "unavailable";
type Sort = "newest" | "price-asc" | "price-desc" | "ai-score";

const SORT_LABEL: Record<Sort, string> = {
  newest: "Newest first",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  "ai-score": "AI score",
};

function isUnavailable(item: ItemView): boolean {
  return item.status === "missing" || Boolean(item.notInterested);
}

function priceLabel(item: ItemView): string {
  if (typeof item.priceFormatted === "string") return item.priceFormatted;
  return formatPrice(item.price as number | string | null);
}

function statusMeta(item: ItemView): { text: string; className: string } | null {
  if (item.notInterested) {
    return {
      text: "Not interested",
      className: "bg-secondary text-secondary-foreground dark:bg-secondary",
    };
  }
  if (item.status === "missing") {
    return {
      text: "Gone",
      className: "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300",
    };
  }
  return null; // available = default, no badge noise
}

export function ListingsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemView[]>([]);
  const [filter, setFilter] = useState<Filter>("available");
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [passThreshold, setPassThreshold] = useState(65);
  const listTopRef = useRef<HTMLDivElement>(null);

  /** One fetch of everything — filters/search/sort switch instantly afterwards. */
  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (opts?.soft) setRefreshing(true);
    else setLoading(true);
    try {
      setItems(await api.items(300, "all"));
      // Score color bands follow the configured threshold (failure = default)
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

  const counts = useMemo(() => {
    const c = { available: 0, all: items.length, unavailable: 0 };
    for (const item of items) {
      if (isUnavailable(item)) c.unavailable++;
      else c.available++;
    }
    return c;
  }, [items]);

  const visible = useMemo(() => {
    let rows =
      filter === "available"
        ? items.filter((i) => !isUnavailable(i))
        : filter === "unavailable"
          ? items.filter(isUnavailable)
          : items;

    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (i) =>
          String(i.name).toLowerCase().includes(q) ||
          String(i.engineSlug ?? "").toLowerCase().includes(q),
      );
    }

    const priceOf = (i: ItemView) => (typeof i.price === "number" ? i.price : Number.MAX_SAFE_INTEGER);
    const scoreOf = (i: ItemView) => (typeof i.aiScore === "number" ? i.aiScore : -1);
    const sorted = [...rows];
    if (sort === "price-asc") sorted.sort((a, b) => priceOf(a) - priceOf(b));
    else if (sort === "price-desc") sorted.sort((a, b) => priceOf(b) - priceOf(a));
    else if (sort === "ai-score") sorted.sort((a, b) => scoreOf(b) - scoreOf(a));
    else
      sorted.sort(
        (a, b) => new Date(String(b.firstSeenAt)).getTime() - new Date(String(a.firstSeenAt)).getTime(),
      );
    return sorted;
  }, [items, filter, query, sort]);

  function openDetails(id: string) {
    navigate(`/listings/${encodeURIComponent(id)}`);
  }

  /** Remove from current view after a short exit animation — keeps scroll position stable. */
  function removeWithExit(id: string, delayMs = 220) {
    setExiting((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((row) => row.id !== id));
      setExiting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, delayMs);
  }

  async function dismiss(item: ItemView) {
    if (busyId || exiting.has(item.id)) return;
    setBusyId(item.id);

    // Optimistic: leave the list immediately so it never "jumps" to the end
    removeWithExit(item.id);

    try {
      await api.setNotInterested(item.id, true);
      toast("Hidden as not interested", {
        description: "Find it under Hidden",
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              try {
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
      toast.error(err instanceof Error ? err.message : "Update failed");
      // Restore list on failure
      await load({ soft: true });
    } finally {
      setBusyId(null);
    }
  }

  async function restore(item: ItemView) {
    if (busyId || exiting.has(item.id)) return;
    setBusyId(item.id);
    removeWithExit(item.id);
    try {
      await api.setNotInterested(item.id, false);
      toast.success("Tracking again");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
      await load({ soft: true });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <ToolbarSkeleton />
        <ListingSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className="space-y-4" ref={listTopRef}>
      {/* Sticky toolbar — filters, search, sort */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-3 space-y-2.5 border-b border-border/50 bg-background/90 px-3 py-2.5 backdrop-blur-xl sm:-mx-4 sm:px-4 lg:top-0 lg:mx-0 lg:px-0">
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            className="min-w-0 flex-1 sm:flex-none"
            options={[
              { value: "available", label: "Active", count: counts.available },
              { value: "all", label: "All", count: counts.all },
              { value: "unavailable", label: "Hidden", count: counts.unavailable },
            ]}
          />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-10 w-10 shrink-0 rounded-xl"
            onClick={() => void load({ soft: true })}
            disabled={refreshing}
            aria-label="Refresh listings"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search listings…"
              aria-label="Search listings"
              className={cn(
                "h-10 w-full rounded-xl border border-input bg-card/70 pl-9 pr-9 text-sm",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 shrink-0 gap-1.5 rounded-xl px-2.5 text-xs text-muted-foreground sm:px-3"
                aria-label={`Sort: ${SORT_LABEL[sort]}`}
                title={`Sort: ${SORT_LABEL[sort]}`}
              >
                <ArrowUpDown className="h-4 w-4 sm:hidden" />
                <span className="hidden sm:inline">{SORT_LABEL[sort]}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
                <DropdownMenuItem key={key} onSelect={() => setSort(key)}>
                  <span className="flex-1">{SORT_LABEL[key]}</span>
                  {sort === key && <Check className="text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {visible.length === 0 ? (
        query ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No matches"
            description={`Nothing matches “${query.trim()}” in ${filter === "available" ? "Active" : filter === "unavailable" ? "Hidden" : "All"} listings.`}
            action={
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<LayoutList className="h-6 w-6" />}
            title={
              filter === "available"
                ? "No active listings"
                : filter === "unavailable"
                  ? "Nothing hidden"
                  : "No listings yet"
            }
            description={
              filter === "available"
                ? "New finds from scrapes show up here. Dismissed ones move to Hidden."
                : "Configure a routine and run a scrape to start tracking deals."
            }
          />
        )
      ) : (
        <>
          <p className="px-0.5 text-xs text-muted-foreground">
            {visible.length} listing{visible.length === 1 ? "" : "s"}
            {refreshing && " · refreshing…"}
          </p>
          <ul className="flex flex-col gap-2.5 sm:gap-3">
            {visible.map((item) => {
              const status = statusMeta(item);
              const leaving = exiting.has(item.id);
              const unavailable = isUnavailable(item);
              const imgBroken = brokenImages.has(item.id);
              const dropped =
                typeof item.prevPrice === "number" &&
                typeof item.price === "number" &&
                item.prevPrice > item.price
                  ? item.prevPrice - item.price
                  : null;

              return (
                <li
                  key={item.id}
                  className={cn(
                    "transition-all duration-200 ease-out",
                    leaving && "pointer-events-none -translate-x-2 scale-[0.98] opacity-0",
                  )}
                >
                  <article
                    className={cn(
                      "group overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card",
                      "transition-shadow hover:shadow-card-hover",
                      unavailable && "opacity-90",
                    )}
                  >
                    <div className="flex">
                      {/* Image */}
                      <button
                        type="button"
                        onClick={() => openDetails(item.id)}
                        className="relative w-[7.25rem] shrink-0 self-stretch bg-muted sm:w-36"
                        aria-label={`Open ${item.name}`}
                      >
                        {item.image && !imgBroken ? (
                          <img
                            src={String(item.image)}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                            onError={() =>
                              setBrokenImages((prev) => new Set(prev).add(item.id))
                            }
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                            <LayoutList className="h-6 w-6" />
                          </div>
                        )}
                      </button>

                      {/* Body */}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <button
                          type="button"
                          onClick={() => openDetails(item.id)}
                          className="flex min-w-0 flex-1 flex-col items-start gap-1.5 p-3 text-left sm:p-3.5"
                        >
                          <div className="flex w-full items-start justify-between gap-3">
                            <h3 className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium leading-snug text-foreground sm:text-[15px]">
                              {String(item.name)}
                            </h3>
                            <span className="flex shrink-0 items-baseline gap-1.5">
                              <span className="text-base font-semibold tabular-nums tracking-tight text-primary sm:text-lg">
                                {priceLabel(item)}
                              </span>
                              {dropped != null && (
                                <span
                                  title={`Price dropped from ${formatPrice(item.prevPrice as number)}${
                                    item.priceChangedAt
                                      ? ` · ${formatRelative(item.priceChangedAt)}`
                                      : ""
                                  }`}
                                  className="cursor-help rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                >
                                  ▼ {formatPrice(dropped)}
                                </span>
                              )}
                            </span>
                          </div>

                          <div className="flex w-full flex-wrap items-center gap-1.5">
                            {status && (
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                  status.className,
                                )}
                              >
                                {status.text}
                              </span>
                            )}
                            {typeof item.aiScore === "number" && (
                              <span
                                title={
                                  item.aiReason
                                    ? `AI score ${item.aiScore}: ${item.aiReason}`
                                    : `AI score ${item.aiScore}`
                                }
                                className={cn(
                                  "cursor-help rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                                  aiScoreClass(item.aiScore, passThreshold),
                                )}
                              >
                                AI {item.aiScore}
                              </span>
                            )}
                            {item.aiScore == null && item.aiVerdict && (
                              <span
                                title={
                                  item.aiReason
                                    ? `AI evaluation: ${item.aiReason}`
                                    : "AI evaluation"
                                }
                                className={cn(
                                  "cursor-help rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                  item.aiVerdict === "pass"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                    : "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300",
                                )}
                              >
                                {item.aiVerdict === "pass" ? "AI pass" : "AI fail"}
                              </span>
                            )}
                            {item.engineSlug && (
                              <Badge
                                variant="outline"
                                className="h-5 border-border/70 px-1.5 font-mono text-[10px] font-normal text-muted-foreground"
                              >
                                {formatEngine(item.engineSlug)}
                              </Badge>
                            )}
                            {(item.sightingCount ?? 0) > 1 && (
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                seen {item.sightingCount}×
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-muted-foreground sm:text-xs">
                            First seen {formatRelative(item.firstSeenAt)}
                          </p>
                        </button>

                        {/* Actions — compact, right-aligned */}
                        <div className="flex items-center justify-end gap-1 border-t border-border/70 px-2 py-1.5">
                          <a
                            href={String(item.url ?? "#")}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-8"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open
                          </a>
                          {item.notInterested ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 gap-1.5 px-2.5 text-xs sm:h-8"
                              disabled={busyId === item.id}
                              onClick={() => void restore(item)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Restore
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground sm:h-8"
                              disabled={busyId === item.id}
                              onClick={() => void dismiss(item)}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Not interested
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="flex h-10 items-center gap-1 rounded-xl bg-muted/80 p-1">
        <div className="h-8 flex-1 animate-pulse rounded-lg bg-card shadow-sm" />
        <div className="h-8 flex-1 animate-pulse rounded-lg" />
        <div className="h-8 flex-1 animate-pulse rounded-lg" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-10 min-w-0 flex-1 animate-pulse rounded-xl bg-muted/80" />
        <div className="h-10 w-28 shrink-0 animate-pulse rounded-xl bg-muted/80" />
      </div>
    </div>
  );
}
