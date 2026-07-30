import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import type { StatusResponse } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/Spinner";
import { cn } from "@/lib/utils";

/** Base poll interval; faster while a scrape is running. */
const POLL_IDLE_MS = 5_000;
const POLL_ACTIVE_MS = 2_000;

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const scrapeActive = Boolean(status?.scheduler.scrapeInProgress);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await api.status();
      setStatus(next);
      setError(null);
      setLastPolledAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // Initial load + adaptive polling
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ms = scrapeActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const t = setInterval(() => void load(), ms);
    return () => clearInterval(t);
  }, [load, scrapeActive]);

  // Tick relative timestamps every 15s without refetch
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Refresh when tab becomes visible again
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  if (loading && !status) return <PageLoader />;

  if (!status) {
    return (
      <p className="text-muted-foreground">
        {error ?? "Status unavailable."}
      </p>
    );
  }

  const successRuns = status.runs.filter((r) => r.status === "done").length;
  const failedRuns = status.runs.filter((r) => r.status === "error").length;
  const running = status.runs.filter((r) => r.status === "running").length;
  const pollLabel = scrapeActive
    ? "Live · every 2s while scraping"
    : "Live · updates every 5s";

  // re-render relative times when `now` ticks
  void now;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Services, schedule, recent runs</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "inline-flex h-2 w-2 rounded-full",
              error
                ? "bg-destructive"
                : scrapeActive
                  ? "bg-amber-500 animate-pulse"
                  : "bg-emerald-500",
            )}
            aria-hidden
          />
          <span>{error ? "Poll failed — retrying" : pollLabel}</span>
          {lastPolledAt && !error && (
            <span className="hidden tabular-nums text-muted-foreground/80 sm:inline">
              · {formatRelative(lastPolledAt.toISOString())}
            </span>
          )}
        </div>
      </div>

      {status.scheduler.scrapeInProgress && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Scrape in progress…
        </div>
      )}

      {/* Service health — compact chips */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {status.services.map((s) => (
          <div
            key={s.name}
            className="rounded-2xl border border-border/80 bg-card p-3 shadow-sm"
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              {s.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="truncate text-xs font-medium capitalize text-muted-foreground">
                {s.name}
              </span>
            </div>
            <p className="text-sm font-semibold">{s.ok ? "Healthy" : "Down"}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{s.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            {(
              [
                ["Interval", `every ${status.scheduler.scrapIntervalMinutes} min`],
                [
                  "Next scrape",
                  `${formatRelative(status.scheduler.nextScrapeAt)} · ${formatDateTime(status.scheduler.nextScrapeAt)}`,
                ],
                [
                  "Last scrape",
                  `${formatRelative(status.scheduler.lastScrapeAt)} · ${formatDateTime(status.scheduler.lastScrapeAt)}`,
                ],
                ["Notify", "After scrape (if findings)"],
                [
                  "Last notify",
                  status.scheduler.lastNotifyAt
                    ? `${formatRelative(status.scheduler.lastNotifyAt)} · ${formatDateTime(status.scheduler.lastNotifyAt)}`
                    : "—",
                ],
              ] as const
            ).map(([label, value], i, arr) => (
              <div
                key={label}
                className={cn(
                  "flex items-start justify-between gap-4 py-2.5 text-sm",
                  i < arr.length - 1 && "border-b border-border/60",
                )}
              >
                <span className="shrink-0 text-muted-foreground">{label}</span>
                <span className="text-right font-medium leading-snug">{value}</span>
              </div>
            ))}
            <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
              Up since {formatDateTime(status.scheduler.scraperStartedAt)} ·{" "}
              {status.pushSubscribers} push subscriber
              {status.pushSubscribers === 1 ? "" : "s"}
              {status.scheduler.scrapeInProgress ? " · scrape running" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Run summary
            </CardTitle>
            <CardDescription>Last {status.runs.length} jobs</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="success">{successRuns} success</Badge>
            <Badge variant="destructive">{failedRuns} failed</Badge>
            {running > 0 && <Badge variant="warning">{running} running</Badge>}
            <Badge variant="secondary">
              {[
                status.transports.logger && "log",
                status.transports.push && "push",
              ]
                .filter(Boolean)
                .join(" + ") || "no transports"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription>Newest first · auto-refreshed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {status.runs.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No runs yet</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {status.runs.map((run) => (
                <li key={run.id} className="px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{run.id}</span>
                      <Badge
                        variant={
                          run.status === "done"
                            ? "success"
                            : run.status === "error"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(run.startedAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{formatDateTime(run.startedAt)}</span>
                    <span>
                      {run.routinesTotal ?? "—"} routines · {run.listingsFound ?? "—"} new
                    </span>
                  </div>
                  {run.error && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-destructive">{run.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
