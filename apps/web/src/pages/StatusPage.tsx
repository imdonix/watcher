import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  XCircle,
} from "lucide-react";
import type { ScrapeRunJob, StatusResponse } from "@watcher/shared";
import { AI_EVALUATION_JOB_SLUG, ITEM_DETAILS_JOB_SLUG } from "@watcher/shared";
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
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [jobsByRun, setJobsByRun] = useState<Record<number, ScrapeRunJob[]>>({});
  const [jobsLoadingId, setJobsLoadingId] = useState<number | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
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

  const toggleRun = useCallback((runId: number) => {
    setExpandedRunId((prev) => {
      if (prev === runId) return null;
      void loadJobs(runId);
      return runId;
    });
  }, [loadJobs]);

  // Initial load + adaptive polling
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ms = scrapeActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const t = setInterval(() => void load(), ms);
    return () => clearInterval(t);
  }, [load, scrapeActive]);

  // Refresh expanded run jobs while a scrape is active (counts update live)
  useEffect(() => {
    if (!scrapeActive || expandedRunId == null) return;
    const t = setInterval(() => void loadJobs(expandedRunId, true), POLL_ACTIVE_MS);
    return () => clearInterval(t);
  }, [scrapeActive, expandedRunId, loadJobs]);

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
  const incompleteRuns = status.runs.filter((r) => r.status === "incomplete").length;
  const pollLabel = "Live";

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
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">Scrape in progress</p>
              <p className="text-sm leading-snug opacity-90">
                {status.scheduler.scrapeProgress?.message || "Working…"}
              </p>
              {status.scheduler.scrapeProgress && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5 text-[11px] opacity-75">
                  {status.scheduler.scrapeProgress.runId != null && (
                    <span className="font-mono">#{status.scheduler.scrapeProgress.runId}</span>
                  )}
                  {status.scheduler.scrapeProgress.phase === "routine" &&
                    status.scheduler.scrapeProgress.routineIndex != null &&
                    status.scheduler.scrapeProgress.routinesTotal != null && (
                      <span>
                        Routine {status.scheduler.scrapeProgress.routineIndex}/
                        {status.scheduler.scrapeProgress.routinesTotal}
                      </span>
                    )}
                  {status.scheduler.scrapeProgress.phase === "details" &&
                    status.scheduler.scrapeProgress.detailsTotal != null &&
                    status.scheduler.scrapeProgress.detailsTotal > 0 && (
                      <span>
                        Details {status.scheduler.scrapeProgress.detailsIndex ?? 0}/
                        {status.scheduler.scrapeProgress.detailsTotal}
                      </span>
                    )}
                  {status.scheduler.scrapeProgress.phase === "ai" &&
                    status.scheduler.scrapeProgress.detailsTotal != null &&
                    status.scheduler.scrapeProgress.detailsTotal > 0 && (
                      <span>
                        AI {status.scheduler.scrapeProgress.detailsIndex ?? 0}/
                        {status.scheduler.scrapeProgress.detailsTotal}
                      </span>
                    )}
                  {status.scheduler.scrapeProgress.listingsSeen != null &&
                    status.scheduler.scrapeProgress.listingsSeen > 0 && (
                      <span className="tabular-nums">
                        {status.scheduler.scrapeProgress.listingsSeen} listings seen
                      </span>
                    )}
                  {status.scheduler.scrapeProgress.engineName &&
                    status.scheduler.scrapeProgress.phase === "routine" && (
                      <span className="truncate">
                        {status.scheduler.scrapeProgress.engineName}
                        {status.scheduler.scrapeProgress.routineLabel
                          ? ` · ${status.scheduler.scrapeProgress.routineLabel}`
                          : ""}
                      </span>
                    )}
                </div>
              )}
            </div>
          </div>
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

      {/* Run stats — scannable tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Successful"
          value={successRuns}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <StatTile
          label="Failed"
          value={failedRuns}
          icon={<XCircle className="h-4 w-4" />}
          tone={failedRuns > 0 ? "text-destructive" : "text-muted-foreground"}
        />
        <StatTile
          label="Incomplete"
          value={incompleteRuns}
          icon={<Clock className="h-4 w-4" />}
          tone={incompleteRuns > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}
        />
        <StatTile
          label="Running"
          value={running}
          icon={<Activity className="h-4 w-4" />}
          tone={running > 0 ? "text-primary animate-pulse" : "text-muted-foreground"}
          hint={`last ${status.runs.length} runs`}
        />
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 sm:grid-cols-2">
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
                  [
                    status.transports.logger && "log",
                    status.transports.push && "push",
                  ]
                    .filter(Boolean)
                    .join(" + ") || "none",
                ],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 text-sm"
              >
                <span className="shrink-0 text-muted-foreground">{label}</span>
                <span className="text-right font-medium leading-snug">{value}</span>
              </div>
            ))}
          </div>
          <p className="pt-3 text-xs text-muted-foreground">
            Up since {formatDateTime(status.scheduler.scraperStartedAt)} ·{" "}
            {status.pushSubscribers} push subscriber
            {status.pushSubscribers === 1 ? "" : "s"}
            {status.scheduler.scrapeInProgress ? " · scrape running" : ""}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent runs</CardTitle>
          <CardDescription>
            Latest 10 · expand a run for per-job counts · auto-refreshed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {status.runs.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No runs yet</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {status.runs.map((run) => {
                const expanded = expandedRunId === run.id;
                const jobs = jobsByRun[run.id];
                const loadingJobs = jobsLoadingId === run.id;
                const completeJobs = jobs?.filter((j) => j.complete).length;
                const totalItems = jobs?.reduce((s, j) => s + (j.itemsSeen ?? 0), 0);

                return (
                  <li key={run.id} className="px-4 py-3 sm:px-6">
                    <button
                      type="button"
                      onClick={() => toggleRun(run.id)}
                      className="flex w-full items-start gap-2 text-left"
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          expanded && "rotate-180",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              #{run.id}
                            </span>
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
                            {run.routinesComplete ?? "—"}/{run.routinesTotal ?? "—"} jobs
                            complete · {run.listingsFound ?? "—"} listings seen
                            {run.sightingsCreated != null
                              ? ` · ${run.sightingsCreated} changes`
                              : ""}
                          </span>
                        </div>
                        {run.error && (
                          <p className="mt-1.5 line-clamp-2 text-xs text-destructive">
                            {run.error}
                          </p>
                        )}
                      </div>
                    </button>

                    {expanded && (
                      <div className="mt-3 ml-6 rounded-xl border border-border/70 bg-muted/30 p-3">
                        {loadingJobs && !jobs ? (
                          <p className="text-xs text-muted-foreground">Loading jobs…</p>
                        ) : jobsError && !jobs ? (
                          <p className="text-xs text-destructive">{jobsError}</p>
                        ) : !jobs || jobs.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No routine jobs recorded for this run.
                          </p>
                        ) : (
                          <>
                            <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span>
                                {jobs.length} job{jobs.length === 1 ? "" : "s"}
                              </span>
                              <span>·</span>
                              <span>
                                {completeJobs}/{jobs.length} complete
                              </span>
                              <span>·</span>
                              <span className="tabular-nums">{totalItems} listings total</span>
                            </div>
                            <ul className="space-y-2">
                              {jobs.map((job) => (
                                <li
                                  key={job.id}
                                  className="rounded-lg border border-border/60 bg-card px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <Badge
                                        variant={job.complete ? "success" : "warning"}
                                        className="shrink-0"
                                      >
                                        {job.complete ? "ok" : "incomplete"}
                                      </Badge>
                                      <span className="truncate text-xs font-medium">
                                        {job.engineSlug === ITEM_DETAILS_JOB_SLUG
                                          ? "Item details"
                                          : job.engineSlug === AI_EVALUATION_JOB_SLUG
                                            ? "AI evaluation"
                                            : job.engineSlug}
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
                                    <span className="shrink-0 tabular-nums text-sm font-semibold">
                                      {job.itemsSeen ?? 0}
                                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                                        {job.engineSlug === ITEM_DETAILS_JOB_SLUG
                                          ? "scraped"
                                          : job.engineSlug === AI_EVALUATION_JOB_SLUG
                                            ? "evaluated"
                                            : "listings"}
                                      </span>
                                    </span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                    <span className="tabular-nums">
                                      pages {job.pagesFetched ?? 0}/{job.pagesPlanned ?? "—"}
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
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-1.5">
        <span className={cn("[&_svg]:h-4 [&_svg]:w-4", tone)}>{icon}</span>
        <span className="truncate text-xs font-medium capitalize text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
