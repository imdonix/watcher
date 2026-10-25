/** Scores below this (but under the pass threshold) get the amber band. */
export const AI_MID_SCORE = 40;

/** Same bands as Badge variants. */
export function aiScoreVariant(score: number, threshold: number): "success" | "warning" | "destructive" {
  if (score >= threshold) return "success";
  if (score >= AI_MID_SCORE) return "warning";
  return "destructive";
}
