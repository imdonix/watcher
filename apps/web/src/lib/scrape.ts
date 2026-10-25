import type { ScrapeProgress } from "@watcher/shared";

/** Short line 1 for progress chips (counters where available). */
export function scrapePhaseLine(p: ScrapeProgress | null): string {
  if (!p) return "Starting…";
  switch (p.phase) {
    case "routine":
      return p.routineIndex != null && p.routinesTotal != null
        ? `Routine ${p.routineIndex}/${p.routinesTotal}`
        : "Scraping listings";
    case "details":
      return p.detailsTotal != null && p.detailsTotal > 0
        ? `Details ${p.detailsIndex ?? 0}/${p.detailsTotal}`
        : "Item details…";
    case "ai":
      return p.detailsTotal != null && p.detailsTotal > 0
        ? `AI ${p.detailsIndex ?? 0}/${p.detailsTotal}`
        : "AI evaluation…";
    case "finishing":
      return "Finishing up";
    case "notify":
      return "Sending notifications";
    case "starting":
      return "Starting…";
    default:
      return "Scraping…";
  }
}

/** Line 2 for progress chips — context without repeating line 1. */
export function scrapePhaseSub(p: ScrapeProgress | null): string {
  if (!p) return "Scrape requested";
  if (p.phase === "routine") return p.engineName ?? p.message;
  if (p.phase === "details" || p.phase === "ai") return p.routineLabel ?? p.message;
  return p.message;
}

/** Best-effort percent for a progress bar; null when the phase has no counters. */
export function scrapePercent(p: ScrapeProgress | null): number | null {
  if (!p) return null;
  if (p.phase === "routine" && p.routineIndex != null && p.routinesTotal) {
    return Math.min(100, Math.round((p.routineIndex / p.routinesTotal) * 100));
  }
  if (
    (p.phase === "details" || p.phase === "ai") &&
    p.detailsIndex != null &&
    p.detailsTotal
  ) {
    return Math.min(100, Math.round((p.detailsIndex / p.detailsTotal) * 100));
  }
  if (p.phase === "finishing" || p.phase === "notify") return 100;
  return null;
}
