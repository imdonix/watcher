import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import type { ScrapeRunJob, StatusResponse } from "@watcher/shared";
import { AI_EVALUATION_JOB_SLUG, ITEM_DETAILS_JOB_SLUG } from "@watcher/shared";
import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { scrapePercent, scrapePhaseLine } from "@/lib/scrape";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/Spinner";
import { StatCard } from "@/components/StatCard";

/** Base poll interval; faster while a scrape is running. */
const POLL_IDLE_MS = 5_000;
const POLL_ACTIVE_MS = 2_000;

function jobName(job: ScrapeRunJob): string {
  if (job.engineSlug === ITEM_DETAILS_JOB_SLUG) return "Item details";
  if (job.engineSlug === AI_EVALUATION_JOB_SLUG) return "AI evaluation";
  return job.engineSlug;
}

function jobUnit(job: ScrapeRunJob): string {
  if (job.engineSlug === ITEM_DETAILS_JOB_SLUG) return "scraped";
  if (job.engineSlug === AI_EVALUATION_JOB_SLUG) return "evaluated";
  return "listings";
}

const SERVICE_LABELS: Record<string, string> = {
  api: "API",
  database: "Database",
  scraper: "Scraper",
  "web-push": "Web Push",
};

function runBadge(status: string) {
  if (status === "done") return <Badge variant="success">done</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  if (status === "running") return <Badge variant="info">running</Badge>;
  return <Badge variant="warning">{status}</Badge>;
}

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [jobsByRun, setJobsByRun] = useState<Record<number, ScrapeRunJob[]>>({});
  const [jobsLoadingId, setJobsLoadingId] = useState<number | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const scrapeActive = Boolean(status?.scheduler.scrapeInProgress);

  const load = useCallback(async (opts?: { manual?: boolean }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (opts?.manual) setRefreshing(true);
    try {
      const next = await api.status();
      setStatus(next);
      setError(null);
      setLastPolledAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }, []);

  const jobsCacheRef = useRef<Record<number, ScrapeRunJob[]>>({});

  const loadJobs = useCallback(async (runId: number, force = false) => {
    if (!force && jobsCacheRef.current[runId]) return;
    setJobsLoadingId(runId);
    setJobsError(null);
    try {
      const jobs = await api.runJobs(runId);
      jobsCacheRef.current = { ...jobsCacheRef.current, [runId]: jobs };
      setJobsByRun(jobsCacheRef.current);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setJobsLoadingId(null);
    }
  }, []);

  const toggleRun = useCallback(
    (runId: number) => {
      setExpandedRunId((prev) => {
        if (prev === runId) return null;
        void loadJobs(runId);
        return runId;
      });
    },
    [loadJobs],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ms = scrapeActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const t = setInterval(() => void load(), ms);
    return () => clearInterval(t);
  }, [load, scrapeActive]);

  useEffect(() => {
    if (!scrapeActive || expandedRunId == null) return;
    const t = setInterval(() => void loadJobs(expandedRunId, true), POLL_ACTIVE_MS);
    return () => clearInterval(t);
  }, [scrapeActive, expandedRunId, loadJobs]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  if (loading && !status) return <PageLoader label="Loading status…" />;

  if (!status) {
    return (
      <div className="space-y-4">
        <PageHeader title="Status" />
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {error ?? "Status unavailable."}
        </div>
      </div>
    );
  }

  const successRuns = status.runs.filter((r) => r.status === "done").length;
  const failedRuns = status.runs.filter((r) => r.status === "error").length;
  const running = status.runs.filter((r) => r.status === "running").length;
  const incompleteRuns = status.runs.filter((r) => r.status === "incomplete").length;
  const progress = status.scheduler.scrapeProgress ?? null;
  const percent = scrapePercent(progress);

  // re-render relative timestamps when `now` ticks
  void now;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        description="Live scraper services, scheduler and the latest runs. Updates automatically."
        actions={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "size-2 rounded-full",
                  error
                    ? "bg-destructive"
                    : scrapeActive
                      ? "animate-pulse bg-amber-500"
                      : "bg-emerald-500",
                )}
                aria-hidden
              />
              {error ? "Poll failed" : "Live"}
              {lastPolledAt && !error && (
                <span className="hidden tabular-nums sm:inline">
                  · {formatRelative(lastPolledAt.toISOString())}
                </span>
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ manual: true })}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
          Could not refresh status: {error}. Retrying automatically.
        </div>
      )}

      {status.scheduler.scrapeInProgress && (
        <Card className="gap-4 border-amber-500/30 bg-amber-500/[0.04] py-4">
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-amber-500/15">
                  <RefreshCw className="size-3.5 animate-spin text-amber-600 dark:text-amber-400" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Scrape in progress</p>
                  <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                    {progress?.message || "Working…"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {progress?.runId != null && (
                  <Badge variant="outline" className="font-mono">
                    #{progress.runId}
                  </Badge>
                )}
                <Badge variant="warning">{scrapePhaseLine(progress)}</Badge>
              </div>
            </div>

            {percent != null && (
              <div className="space-y-1.5">
                <Progress
                  value={percent}
                  className="h-2 bg-amber-500/15 [&>div]:bg-amber-500"
                />
                <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span>{percent}%</span>
                  {progress?.listingsSeen != null && (
                    <span>{progress.listingsSeen} listings seen</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {progress?.phase === "routine" &&
                progress.routineIndex != null &&
                progress.routinesTotal != null && (
                  <span>
                    Routine {progress.routineIndex}/{progress.routinesTotal}
                  </span>
                )}
              {(progress?.phase === "details" || progress?.phase === "ai") &&
                progress.detailsTotal != null &&
                progress.detailsTotal > 0 && (
                  <span>
                    {progress.phase === "details" ? "Details" : "AI"}{" "}
                    {progress.detailsIndex ?? 0}/{progress.detailsTotal}
                  </span>
                )}
              {progress?.engineName && progress.phase === "routine" && (
                <span className="truncate">
                  {progress.engineName}
                  {progress.routineLabel ? ` · ${progress.routineLabel}` : ""}
                </span>
              )}
              {progress?.routineLabel &&
                (progress.phase === "details" || progress.phase === "ai") && (
                  <span className="truncate">{progress.routineLabel}</span>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard
          label="Successful"
          value={successRuns}
          icon={<CheckCircle2 />}
          tone="success"
          hint={`last ${status.runs.length} runs`}
        />
        <StatCard
          label="Failed"
          value={failedRuns}
          icon={<XCircle />}
          tone={failedRuns > 0 ? "destructive" : "muted"}
          hint={`last ${status.runs.length} runs`}
        />
        <StatCard
          label="Incomplete"
          value={incompleteRuns}
          icon={<Clock />}
          tone={incompleteRuns > 0 ? "warning" : "muted"}
          hint={`last ${status.runs.length} runs`}
        />
        <StatCard
          label="Running"
          value={running}
          icon={<Activity className={running > 0 ? "animate-pulse" : undefined} />}
          tone={running > 0 ? "primary" : "muted"}
          hint={scrapeActive ? "scrape active" : "idle"}
        />
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {status.services.map((s) => (
          <div
            key={s.name}
            className="rounded-xl border bg-card p-3.5 shadow-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Server className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium text-muted-foreground">
                  {SERVICE_LABELS[s.name] ?? s.name}
                </span>
              </span>
              <Badge variant={s.ok ? "success" : "destructive"}>
                {s.ok ? "Healthy" : "Down"}
              </Badge>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {s.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-muted-foreground" />
              Schedule
            </CardTitle>
            <CardDescription>Next automatic scrape and notification state.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
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
                  ["Notify", "After scrape (if new listings)"],
                  [
                    "Last notify",
                    status.scheduler.lastNotifyAt
                      ? `${formatRelative(status.scheduler.lastNotifyAt)} · ${formatDateTime(status.scheduler.lastNotifyAt)}`
                      : "—",
                  ],
                  [
                    "Transports",
                    [status.transports.logger && "log", status.transports.push && "push"]
                      .filter(Boolean)
                      .join(" + ") || "none",
                  ],
                  ["Push subscribers", `${status.pushSubscribers}`],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 py-2.5 text-sm"
                >
                  <dt className="shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium leading-snug">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t pt-3 text-[11px] text-muted-foreground">
              Scraper up since {formatDateTime(status.scheduler.scraperStartedAt)}
              {status.scheduler.scrapeInProgress ? " · scrape running" : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
            <CardDescription>
              Latest {status.runs.length} · expand for per-job counts · auto-refreshed
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {status.runs.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-muted-foreground sm:px-6">
                No runs yet — start a scrape from the sidebar or wait for the scheduler.
              </p>
            ) : (
              <ul className="divide-y border-t">
                {status.runs.map((run) => {
                  const expanded = expandedRunId === run.id;
                  const jobs = jobsByRun[run.id];
                  const loadingJobs = jobsLoadingId === run.id;
                  const completeJobs = jobs?.filter((j) => j.complete).length;
                  const totalItems = jobs?.reduce((s, j) => s + (j.itemsSeen ?? 0), 0);

                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        onClick={() => toggleRun(run.id)}
                        className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/35 sm:px-6"
                        aria-expanded={expanded}
                      >
                        <ChevronDown
                          className={cn(
                            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-muted-foreground">
                                #{run.id}
                              </span>
                              {runBadge(run.status)}
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {formatRelative(run.startedAt)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span>{formatDateTime(run.startedAt)}</span>
                            <span>
                              {run.routinesComplete ?? "—"}/{run.routinesTotal ?? "—"} jobs ·{" "}
                              {run.listingsFound ?? "—"} listings
                              {run.sightingsCreated != null
                                ? ` · ${run.sightingsCreated} changes`
                                : ""}
                            </span>
                          </div>
                          {run.error && (
                            <p className="mt-1 line-clamp-2 text-xs text-destructive">{run.error}</p>
                          )}
                        </div>
                      </button>

                      {expanded && (
                        <div className="px-4 pb-3 sm:px-6">
                          <div className="rounded-lg border bg-muted/25 p-2.5">
                            {loadingJobs && !jobs ? (
                              <p className="p-1 text-xs text-muted-foreground">Loading jobs…</p>
                            ) : jobsError && !jobs ? (
                              <p className="p-1 text-xs text-destructive">{jobsError}</p>
                            ) : !jobs || jobs.length === 0 ? (
                              <p className="p-1 text-xs text-muted-foreground">
                                No routine jobs recorded for this run.
                              </p>
                            ) : (
                              <>
                                <div className="flex flex-wrap gap-x-2 gap-y-1 px-1 pb-2 text-[11px] text-muted-foreground">
                                  <span>
                                    {jobs.length} job{jobs.length === 1 ? "" : "s"}
                                  </span>
                                  <span>·</span>
                                  <span>
                                    {completeJobs}/{jobs.length} complete
                                  </span>
                                  <span>·</span>
                                  <span className="tabular-nums">
                                    {totalItems} listings total
                                  </span>
                                </div>
                                <ul className="space-y-1.5">
                                  {jobs.map((job) => (
                                    <li
                                      key={job.id}
                                      className="rounded-md border bg-card px-2.5 py-2"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                          <Badge
                                            variant={job.complete ? "success" : "warning"}
                                            className="shrink-0"
                                          >
                                            {job.complete ? "ok" : "incomplete"}
                                          </Badge>
                                          <span className="truncate text-xs font-medium">
                                            {jobName(job)}
                                            {job.label &&
                                            job.engineSlug !== ITEM_DETAILS_JOB_SLUG &&
                                            job.engineSlug !== AI_EVALUATION_JOB_SLUG ? (
                                              <span className="font-normal text-muted-foreground">
                                                {" "}
                                                · {job.label}
                                              </span>
                                            ) : job.searchRoutineId != null ? (
                                              <span className="font-normal text-muted-foreground">
                                                {" "}
                                                · routine #{job.searchRoutineId}
                                              </span>
                                            ) : null}
                                          </span>
                                        </div>
                                        <span className="shrink-0 tabular-nums text-xs font-semibold">
                                          {job.itemsSeen ?? 0}{" "}
                                          <span className="font-normal text-muted-foreground">
                                            {jobUnit(job)}
                                          </span>
                                        </span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                                        <span className="tabular-nums">
                                          pages {job.pagesFetched ?? 0}/
                                          {job.pagesPlanned ?? "—"}
                                        </span>
                                        {(job.pagesFailed ?? 0) > 0 && (
                                          <span className="tabular-nums text-destructive">
                                            {job.pagesFailed} failed
                                          </span>
                                        )}
                                      </div>
                                      {job.error && (
                                        <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
                                          {job.error}
                                        </p>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
