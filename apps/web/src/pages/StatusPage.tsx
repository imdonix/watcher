import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { StatusResponse } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/Spinner";
import { cn } from "@/lib/utils";

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    try {
      setStatus(await api.status());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !status) return <PageLoader />;

  if (!status) {
    return <p className="text-muted-foreground">Status unavailable.</p>;
  }

  const successRuns = status.runs.filter((r) => r.status === "done").length;
  const failedRuns = status.runs.filter((r) => r.status === "error").length;
  const running = status.runs.filter((r) => r.status === "running").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Services, schedule, recent runs</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl"
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh status"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

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
          <CardDescription>Newest first</CardDescription>
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
