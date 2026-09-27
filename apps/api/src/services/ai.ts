import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  listings,
  listingSightings,
  searchRoutines,
  scrapeRoutineResults,
  type Database,
} from "@watcher/db";
import {
  AI_EVALUATION_JOB_SLUG,
  findEngineById,
  type ListingItemDetails,
} from "@watcher/shared";
import { log, logError } from "../lib/time";
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  getBooleanSetting,
  getStringSetting,
  SETTING_KEYS,
} from "./settings";

/** Max AI evaluations per scrape run. */
const AI_EVAL_BATCH = 25;
const AI_TIMEOUT_MS = 60_000;
const MAX_DESCRIPTION_CHARS = 2000;

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiVerdict {
  pass: boolean;
  reason: string;
}

export interface AiEvalJobResult {
  planned: number;
  evaluated: number;
  failed: number;
  complete: boolean;
  skipped: boolean;
}

export type AiEvalProgressFn = (info: {
  index: number;
  total: number;
  listingId: string;
  engineSlug: string;
  name: string;
}) => void;

/** AI settings from the settings table (sensible defaults when unset). */
export async function loadAiConfig(db: Database): Promise<AiConfig> {
  const enabled = await getBooleanSetting(db, SETTING_KEYS.aiEnabled);
  const baseUrl = await getStringSetting(db, SETTING_KEYS.aiBaseUrl);
  const apiKey = await getStringSetting(db, SETTING_KEYS.aiApiKey);
  const model = await getStringSetting(db, SETTING_KEYS.aiModel);
  return {
    enabled: enabled !== false,
    baseUrl: (baseUrl ?? "").trim() || AI_DEFAULT_BASE_URL,
    apiKey: (apiKey ?? "").trim(),
    model: (model ?? "").trim() || AI_DEFAULT_MODEL,
  };
}

export function aiConfigured(cfg: AiConfig): boolean {
  return cfg.enabled && Boolean(cfg.apiKey) && Boolean(cfg.model);
}

/** Strip trailing slashes so `${base}/api/chat` composes cleanly. */
function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/chat`;
}

const SYSTEM_PROMPT = `You are a marketplace listing evaluator. You receive the user's evaluation criteria and exactly one listing. Decide whether the listing matches the criteria.

Respond with JSON only, in exactly this shape:
{"pass": true, "reason": "one short sentence"}

Rules:
- Set "pass" to true when the listing matches the criteria, false when it does not.
- If information is missing or you are unsure, set "pass" to false.
- Keep "reason" under 200 characters.
- Write "reason" in the same language the evaluation criteria are written in (Hungarian criteria → Hungarian reason).`;

function buildUserPrompt(
  prompt: string,
  row: typeof listings.$inferSelect,
): string {
  const details = (row.details ?? null) as ListingItemDetails | null;
  const description = typeof details?.description === "string" ? details.description.trim() : "";
  const attributes =
    details?.attributes && Object.keys(details.attributes).length > 0
      ? Object.entries(details.attributes)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join("\n")
      : "";

  const lines = [
    "EVALUATION CRITERIA:",
    prompt.trim(),
    "",
    "LISTING:",
    `Title: ${row.name}`,
    row.lastPrice != null ? `Price: ${row.lastPrice}` : null,
    `Engine: ${row.engineSlug}`,
    `URL: ${row.url}`,
    description ? `Description: ${description.slice(0, MAX_DESCRIPTION_CHARS)}` : null,
    attributes ? `Attributes:\n${attributes}` : null,
  ].filter((l): l is string => l != null && l !== "");

  return lines.join("\n");
}

type ParsedChatResponse = { message?: { content?: string } };

function normalizeVerdict(content: string): AiVerdict {
  let text = content.trim();
  // Tolerate fenced output despite format:"json"
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1]!;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Model returned non-JSON output: ${text.slice(0, 160)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned JSON that is not an object");
  }

  const obj = parsed as Record<string, unknown>;
  const rawPass = obj.pass ?? obj.verdict ?? obj.match;
  let pass: boolean;
  if (typeof rawPass === "boolean") {
    pass = rawPass;
  } else if (typeof rawPass === "string") {
    const v = rawPass.trim().toLowerCase();
    if (["true", "pass", "yes", "match", "matches", "igen"].includes(v)) pass = true;
    else if (["false", "fail", "no", "no match", "does not match", "nem"].includes(v))
      pass = false;
    else throw new Error(`Unrecognized verdict value: ${rawPass}`);
  } else {
    throw new Error("Model output missing boolean \"pass\"");
  }

  const rawReason = obj.reason ?? obj.explanation ?? obj.why;
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!pass && !reason) {
    throw new Error("Model output missing \"reason\" for a failed verdict");
  }
  return { pass, reason: reason.slice(0, 500) };
}

/** Call the Ollama-compatible chat endpoint with forced JSON output. */
export async function callAiModel(cfg: AiConfig, prompt: string, listing: typeof listings.$inferSelect): Promise<AiVerdict> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const res = await fetch(chatUrl(cfg.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(prompt, listing) },
      ],
      stream: false,
      format: "json",
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as ParsedChatResponse;
  const content = data.message?.content ?? "";
  if (!content.trim()) throw new Error("AI response contained no content");
  return normalizeVerdict(content);
}

/** Lightweight connectivity check: list models on the configured endpoint. */
export async function testAiConnection(cfg: AiConfig): Promise<{ ok: boolean; detail: string }> {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  let lastError = "";

  for (const path of ["/api/tags", "/v1/models"]) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => ({}))) as { models?: unknown[] };
      const count = Array.isArray(data.models) ? data.models.length : 0;
      return { ok: true, detail: `reachable · ${count} model${count === 1 ? "" : "s"}` };
    } catch (err) {
      lastError = String(err);
    }
  }
  return {
    ok: false,
    detail: `unreachable${lastError ? `: ${lastError.slice(0, 160)}` : ""}`,
  };
}

interface PromptRoutine {
  id: number;
  engineSlug: string;
  prompt: string;
}

/** Enabled routines that define an AI evaluation prompt, mapped to engine slugs. */
export async function loadPromptRoutines(db: Database): Promise<PromptRoutine[]> {
  const rows = await db.select().from(searchRoutines).where(eq(searchRoutines.enabled, true));
  const out: PromptRoutine[] = [];
  for (const row of rows) {
    const prompt = String(row.config?.aiPrompt ?? "").trim();
    if (!prompt) continue;
    const engine = findEngineById(row.engineId);
    if (!engine) continue;
    out.push({ id: row.id, engineSlug: engine.slug, prompt });
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Prompt for a listing: routines on the same engine; when several match,
 * prefer the routine that most recently found the listing.
 */
async function resolvePromptForListing(
  db: Database,
  routines: PromptRoutine[],
  row: typeof listings.$inferSelect,
): Promise<PromptRoutine | null> {
  const candidates = routines.filter((r) => r.engineSlug === row.engineSlug);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const sightings = await db
    .select({ routineId: listingSightings.searchRoutineId })
    .from(listingSightings)
    .where(eq(listingSightings.listingId, row.id))
    .orderBy(desc(listingSightings.observedAt))
    .limit(10);
  for (const s of sightings) {
    const hit = candidates.find((c) => c.id === s.routineId);
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

/**
 * Evaluate one listing with the cloud model and persist the verdict.
 * Throws when no prompt matches, the model errors, or output is invalid.
 */
export async function evaluateListing(
  db: Database,
  cfg: AiConfig,
  row: typeof listings.$inferSelect,
  routines?: PromptRoutine[],
): Promise<AiVerdict & { model: string }> {
  const pool = routines ?? (await loadPromptRoutines(db));
  const chosen = await resolvePromptForListing(db, pool, row);
  if (!chosen) {
    throw new Error(`No AI evaluation prompt configured for engine ${row.engineSlug}`);
  }

  const verdict = await callAiModel(cfg, chosen.prompt, row);
  const now = new Date();
  await db
    .update(listings)
    .set({
      aiVerdict: verdict.pass ? "pass" : "fail",
      aiReason: verdict.reason,
      aiModel: cfg.model,
      aiEvaluatedAt: now,
      updatedAt: now,
    })
    .where(eq(listings.id, row.id));

  return { ...verdict, model: cfg.model };
}

/**
 * Scrape-run job: evaluate listings that have never been evaluated or whose
 * item details changed since the last evaluation. Skips silently when the
 * feature is disabled / unconfigured / no routine has a prompt.
 */
export async function runAiEvaluateJob(
  db: Database,
  scrapeRunId: number,
  onProgress?: AiEvalProgressFn,
): Promise<AiEvalJobResult> {
  const cfg = await loadAiConfig(db);
  if (!aiConfigured(cfg)) {
    log("AI", "evaluation skipped (disabled or missing API key/model)");
    return { planned: 0, evaluated: 0, failed: 0, complete: true, skipped: true };
  }

  const routines = await loadPromptRoutines(db);
  if (routines.length === 0) {
    log("AI", "evaluation skipped (no routine defines an AI prompt)");
    return { planned: 0, evaluated: 0, failed: 0, complete: true, skipped: true };
  }

  const engines = [...new Set(routines.map((r) => r.engineSlug))];
  const pending = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.status, "active"),
        eq(listings.notInterested, false),
        inArray(listings.engineSlug, engines),
        or(
          isNull(listings.aiEvaluatedAt),
          and(
            isNotNull(listings.detailsScrapedAt),
            sql`${listings.aiEvaluatedAt} < ${listings.detailsScrapedAt}`,
          ),
        ),
      ),
    )
    .orderBy(desc(listings.firstSeenAt))
    .limit(AI_EVAL_BATCH);

  const planned = pending.length;
  if (planned === 0) {
    log("AI", "no listings pending evaluation");
    return { planned: 0, evaluated: 0, failed: 0, complete: true, skipped: true };
  }

  log("AI", `evaluation job: ${planned} listing(s) pending (model ${cfg.model})`);

  let evaluated = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]!;
    onProgress?.({
      index: i + 1,
      total: planned,
      listingId: row.id,
      engineSlug: row.engineSlug,
      name: row.name,
    });
    try {
      const verdict = await evaluateListing(db, cfg, row, routines);
      evaluated++;
      log("AI", `${verdict.pass ? "pass" : "fail"} ${row.engineSlug} ${row.id}`);
    } catch (err) {
      failed++;
      logError("AI", `${row.id}: ${err}`);
    }
  }

  const complete = failed === 0;
  await db.insert(scrapeRoutineResults).values({
    scrapeRunId,
    searchRoutineId: null,
    engineSlug: AI_EVALUATION_JOB_SLUG,
    complete,
    pagesPlanned: planned,
    pagesFetched: evaluated,
    pagesFailed: failed,
    itemsSeen: evaluated,
    error: failed > 0 ? `${failed}/${planned} AI evaluations failed` : null,
  });

  log("AI", `evaluation job done planned=${planned} ok=${evaluated} failed=${failed}`);
  return { planned, evaluated, failed, complete, skipped: false };
}
