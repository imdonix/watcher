import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpDown,
  Ban,
  Check,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ListingSkeleton, TileSkeleton } from "@/components/Skeleton";

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
  /** Pending per-row exit-animation timers (id → timeout handle). */
  const flipTimers = useRef(new Map<string, number>());

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
    },
    [],
  );

  const counts = useMemo(() => {
    const c = { available: 0, all: items.length, unavailable: 0 };
    for (const item of items) {
      if (isUnavailable(item)) c.unavailable++;
      else c.available++;
    }
    return c;
  }, [items]);

  const stats = useMemo(() => {
    let drops = 0;
    let aiPass = 0;
    for (const item of items) {
      if (
        typeof item.prevPrice === "number" &&
        typeof item.price === "number" &&
        item.prevPrice > item.price
      ) {
        drops++;
      }
      if (typeof item.aiScore === "number" && item.aiScore >= passThreshold) aiPass++;
    }
    return { drops, aiPass };
  }, [items, passThreshold]);

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

    const priceOf = (i: ItemView) =>
      typeof i.price === "number" ? i.price : Number.MAX_SAFE_INTEGER;
    const scoreOf = (i: ItemView) => (typeof i.aiScore === "number" ? i.aiScore : -1);
    const sorted = [...rows];
    if (sort === "price-asc") sorted.sort((a, b) => priceOf(a) - priceOf(b));
    else if (sort === "price-desc") sorted.sort((a, b) => priceOf(b) - priceOf(a));
    else if (sort === "ai-score") sorted.sort((a, b) => scoreOf(b) - scoreOf(a));
    else
      sorted.sort(
        (a, b) =>
          new Date(String(b.firstSeenAt)).getTime() -
          new Date(String(a.firstSeenAt)).getTime(),
      );
    return sorted;
  }, [items, filter, query, sort]);

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

  /**
   * Play the exit animation, then flip the row's fields instead of removing it
   * — filters/counts recompute from `items`, so the listing shows up under the
   * other tab without a refetch.
   */
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
          available: item.status === "active",
        },
        started,
      );
      toast("Hidden as not interested", {
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
      toast.success("Tracking again");
    } catch (err) {
      clearExiting(item.id);
      toast.error(err instanceof Error ? err.message : "Update failed");
      await load({ soft: true });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Listings"
          description="Every deal your routines have found, ranked and searchable."
        />
        <TileSkeleton />
        <ListingSkeleton count={6} />
      </div>
    );
  }

  const emptyState = query ? (
    <EmptyState
      icon={<Search className="size-5" />}
      title="No matches"
      description={`Nothing matches “${query.trim()}” in ${
        filter === "available" ? "Active" : filter === "unavailable" ? "Hidden" : "All"
      } listings.`}
      action={
        <Button variant="outline" size="sm" onClick={() => setQuery("")}>
          Clear search
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<LayoutList className="size-5" />}
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
          : filter === "unavailable"
            ? "Listings you mark as not interested will be collected here."
            : "Configure a routine and run a scrape to start tracking deals."
      }
      action={
        filter === "unavailable" || filter === "all" ? (
          <Button variant="outline" size="sm" onClick={() => navigate("/routines")}>
            Manage routines
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Listings"
        description={
          items.length > 0
            ? `${counts.available} active · ${counts.unavailable} hidden · ${counts.all} tracked in total`
            : "Every deal your routines have found, ranked and searchable."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ soft: true })}
            disabled={refreshing}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            <span>Refresh</span>
          </Button>
        }
      />

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard
            label="Active"
            value={counts.available}
            icon={<LayoutList />}
            tone="primary"
            hint="Visible on Active"
          />
          <StatCard
            label="Hidden"
            value={counts.unavailable}
            icon={<EyeOff />}
            hint="Dismissed or gone"
          />
          <StatCard
            label="Price drops"
            value={stats.drops}
            icon={<TrendingDown />}
            tone={stats.drops > 0 ? "success" : "muted"}
            hint="Since first seen"
          />
          <StatCard
            label="AI pass"
            value={stats.aiPass}
            icon={<Sparkles />}
            tone={stats.aiPass > 0 ? "primary" : "muted"}
            hint={`Score ≥ ${passThreshold}`}
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as Filter)}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:flex">
              <TabsTrigger value="available">
                Active
                <span className="tabular-nums text-muted-foreground">{counts.available}</span>
              </TabsTrigger>
              <TabsTrigger value="all">
                All
                <span className="tabular-nums text-muted-foreground">{counts.all}</span>
              </TabsTrigger>
              <TabsTrigger value="unavailable">
                Hidden
                <span className="tabular-nums text-muted-foreground">{counts.unavailable}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {visible.length} listing{visible.length === 1 ? "" : "s"}
            {refreshing && " · refreshing…"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or site…"
              aria-label="Search listings"
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

          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger
              size="sm"
              className="h-9 w-9 shrink-0 justify-center px-0 text-xs [&>svg:last-child]:hidden sm:w-[11.5rem] sm:justify-between sm:px-3 sm:[&>svg:last-child]:block"
              aria-label={`Sort: ${SORT_LABEL[sort]}`}
              title={`Sort: ${SORT_LABEL[sort]}`}
            >
              <ArrowUpDown className="size-4 shrink-0 text-muted-foreground" />
              <span className="hidden min-w-0 truncate sm:block">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent align="end">
              {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground sm:hidden">
          {visible.length} listing{visible.length === 1 ? "" : "s"}
          {refreshing && " · refreshing…"}
        </span>
      </div>

      {visible.length === 0 ? (
        emptyState
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y divide-border/70">
            {visible.map((item) => {
              const leaving = exiting.has(item.id);
              const unavailable = isUnavailable(item);
              const imgBroken = brokenImages.has(item.id);
              const dropped =
                typeof item.prevPrice === "number" &&
                typeof item.price === "number" &&
                item.prevPrice > item.price
                  ? item.prevPrice - item.price
                  : null;
              const detailLink = `/listings/${encodeURIComponent(item.id)}`;

              return (
                <li
                  key={item.id}
                  className={cn(
                    "group relative flex gap-3 p-3 transition-all duration-200 ease-out hover:bg-muted/35 sm:gap-4 sm:p-4",
                    leaving && "pointer-events-none -translate-x-2 scale-[0.99] opacity-0",
                    unavailable && "opacity-90",
                  )}
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
                      {item.notInterested ? (
                        <Badge variant="secondary">Hidden</Badge>
                      ) : item.status === "missing" ? (
                        <Badge variant="warning">Gone</Badge>
                      ) : null}
                      {dropped != null && (
                        <Badge variant="success">
                          <TrendingDown className="size-3" />-{formatPrice(dropped)}
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
                      {(item.sightingCount ?? 0) > 1 && (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          seen {item.sightingCount}×
                        </span>
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
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {visible.length > 0 && (
        <p className="flex items-center justify-center gap-1.5 pb-1 text-[11px] text-muted-foreground">
          <Check className="size-3" />
          Showing {visible.length} of {items.length} tracked listings
        </p>
      )}
    </div>
  );
}
