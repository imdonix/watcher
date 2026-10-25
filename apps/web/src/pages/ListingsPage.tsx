import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  EyeOff,
  Image as ImageIcon,
  Inbox,
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
import { publishNewCount, readLastSeenAt, writeLastSeenAt } from "@/lib/inbox";
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

function isNewSince(item: ItemView, since: number | null): boolean {
  if (since == null) return false;
  const t = new Date(String(item.firstSeenAt)).getTime();
  return Number.isFinite(t) && t > since;
}

export function ListingsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemView[]>([]);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(readLastSeenAt);
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

  // First visit after installing the feature: start counting from now.
  useEffect(() => {
    if (lastSeenAt != null) return;
    const now = Date.now();
    writeLastSeenAt(now);
    setLastSeenAt(now);
  }, [lastSeenAt]);

  useEffect(
    () => () => {
      for (const t of flipTimers.current.values()) window.clearTimeout(t);
      flipTimers.current.clear();
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

  const newCount = useMemo(
    () => active.filter((item) => isNewSince(item, lastSeenAt)).length,
    [active, lastSeenAt],
  );

  const rows =
    onlyNew && !showHidden
      ? source.filter((item) => isNewSince(item, lastSeenAt))
      : source;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? rows.filter(
          (i) =>
            String(i.name).toLowerCase().includes(q) ||
            String(i.engineSlug ?? "").toLowerCase().includes(q),
        )
      : rows;
    return [...matching].sort(
      (a, b) =>
        new Date(String(b.firstSeenAt)).getTime() - new Date(String(a.firstSeenAt)).getTime(),
    );
  }, [rows, query]);

  // Keep the navigation badge in sync with the inbox.
  useEffect(() => {
    publishNewCount(newCount);
  }, [newCount]);

  // Nothing left unread → leave the "new only" filter automatically.
  useEffect(() => {
    if (onlyNew && newCount === 0) setOnlyNew(false);
  }, [onlyNew, newCount]);

  function markAllSeen() {
    const now = Date.now();
    writeLastSeenAt(now);
    setLastSeenAt(now);
    setOnlyNew(false);
    publishNewCount(0);
    toast.success("Marked all as seen");
  }

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
    setOnlyNew(false);
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
            : `${active.length} potential product${active.length === 1 ? "" : "s"}, newest first${
                newCount > 0 ? ` · ${newCount} new since your last visit` : ""
              }. AI rejects are hidden automatically.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!showHidden && (
              <Button variant="ghost" size="sm" onClick={() => switchView(true)}>
                <EyeOff />
                Hidden
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

      {!showHidden && newCount > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Inbox className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {newCount} new potential product{newCount === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-muted-foreground">
                Since your last check
                {lastSeenAt != null
                  ? ` · ${formatRelative(new Date(lastSeenAt).toISOString())}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={onlyNew ? "secondary" : "outline"}
              onClick={() => setOnlyNew((v) => !v)}
            >
              {onlyNew ? "Show all" : "Show new only"}
            </Button>
            <Button size="sm" variant="ghost" onClick={markAllSeen}>
              Mark all seen
            </Button>
          </div>
        </div>
      )}

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
              const fresh = !showHidden && isNewSince(item, lastSeenAt);
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
                      {fresh && <Badge variant="info">New</Badge>}
                      {showHidden && (
                        <Badge variant="secondary">
                          {item.notInterestedReason === "ai" ? "Hidden by AI" : "Hidden"}
                        </Badge>
                      )}
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
    </div>
  );
}
