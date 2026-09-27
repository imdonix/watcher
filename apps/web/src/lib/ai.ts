/** Fallback when the settings table has no threshold yet. */
export const AI_DEFAULT_PASS_THRESHOLD = 65;

/** Scores below this (but under the pass threshold) get the amber band. */
export const AI_MID_SCORE = 40;

/** Score color bands: >= pass threshold (emerald), >= 40 (amber), else red. */
export function aiScoreClass(score: number, threshold: number): string {
  if (score >= threshold)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300";
  if (score >= AI_MID_SCORE)
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300";
  return "bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300";
}

/** Same bands as Badge variants. */
export function aiScoreVariant(score: number, threshold: number): "success" | "warning" | "destructive" {
  if (score >= threshold) return "success";
  if (score >= AI_MID_SCORE) return "warning";
  return "destructive";
}
