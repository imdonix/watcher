import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, ExternalLink, LayoutList, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ItemView } from "@watcher/shared";
import { formatPrice } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatEngine, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/Spinner";
import { SegmentedControl } from "@/components/SegmentedControl";
import { cn } from "@/lib/utils";

type Filter = "available" | "all" | "unavailable";

function isUnavailable(item: ItemView): boolean {
  return item.status === "missing" || Boolean(item.notInterested);
}

function priceLabel(item: ItemView): string {
  if (typeof item.priceFormatted === "string") return item.priceFormatted;
  return formatPrice(item.price as number | string | null);
}

function statusMeta(item: ItemView): { text: string; className: string } | null {
  if (item.notInterested) {
    return { text: "Not interested", className: "bg-secondary text-secondary-foreground" };
  }
  if (item.status === "missing") {
    return { text: "Gone", className: "bg-amber-100 text-amber-900" };
  }
  return null; // available = default, no badge noise
}

export function ListingsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ItemView[]>([]);
  const [filter, setFilter] = useState<Filter>("available");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const listTopRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (opts?.soft) setRefreshing(true);
      else setLoading(true);
      try {
        setItems(await api.items(200, filter));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load listings");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

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
        description: "Find it under Unavailable",
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

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-4" ref={listTopRef}>
      {/* Sticky filter strip */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-3 space-y-2 border-b border-border/50 bg-background/90 px-3 py-2.5 backdrop-blur-xl sm:-mx-4 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            className="min-w-0 flex-1"
            options={[
              { value: "available", label: "Active" },
              { value: "all", label: "All" },
              { value: "unavailable", label: "Hidden" },
            ]}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl"
            onClick={() => void load({ soft: true })}
            disabled={refreshing}
            aria-label="Refresh listings"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {items.length === 0
            ? "Nothing here"
            : `${items.length} listing${items.length === 1 ? "" : "s"}`}
          {filter === "available" && " · tap a card for details"}
        </p>
      </div>

      {items.length === 0 ? (
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
      ) : (
        <ul className="flex flex-col gap-2.5 sm:gap-3">
          {items.map((item) => {
            const status = statusMeta(item);
            const leaving = exiting.has(item.id);
            const unavailable = isUnavailable(item);

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
                    "group overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm",
                    "transition-shadow hover:shadow-md",
                    unavailable && "opacity-90",
                  )}
                >
                  <div className="flex gap-0 sm:gap-0">
                    {/* Image */}
                    <button
                      type="button"
                      onClick={() => openDetails(item.id)}
                      className="relative w-[7.25rem] shrink-0 self-stretch bg-muted sm:w-36"
                      aria-label={`Open ${item.name}`}
                    >
                      {item.image ? (
                        <img
                          src={String(item.image)}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
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
                        <div className="flex w-full items-start justify-between gap-2">
                          <h3 className="line-clamp-2 text-[14px] font-medium leading-snug text-foreground sm:text-[15px]">
                            {String(item.name)}
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-base font-semibold tabular-nums tracking-tight text-primary sm:text-lg">
                            {priceLabel(item)}
                          </span>
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
                          {item.engineSlug && (
                            <Badge
                              variant="outline"
                              className="h-5 border-border/70 px-1.5 font-mono text-[10px] font-normal text-muted-foreground"
                            >
                              {formatEngine(item.engineSlug)}
                            </Badge>
                          )}
                        </div>

                        <p className="text-[11px] text-muted-foreground sm:text-xs">
                          First seen {formatRelative(item.firstSeenAt)}
                        </p>
                      </button>

                      {/* Actions — full width row, thumb-friendly */}
                      <div className="flex border-t border-border/70">
                        <a
                          href={String(item.url ?? "#")}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "flex min-h-11 flex-1 items-center justify-center gap-1.5 text-sm font-medium text-foreground",
                            "transition-colors hover:bg-muted/70 active:bg-muted",
                            "border-r border-border/70",
                          )}
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          Open
                        </a>
                        {item.notInterested ? (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void restore(item)}
                            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70 active:bg-muted disabled:opacity-50"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => void dismiss(item)}
                            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:bg-muted disabled:opacity-50"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Not interested
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
