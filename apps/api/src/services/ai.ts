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
  type AiUsageModel,
  type AiUsageResponse,
  type ListingItemDetails,
} from "@watcher/shared";
import { log, logError } from "../lib/time";
import {
  AI_DEFAULT_BASE_URL,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_PASS_THRESHOLD,
  getBooleanSetting,
  getNumberSetting,
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
  /** Score >= this counts as pass (0-100). */
  passThreshold: number;
}

export interface AiVerdict {
  score: number;
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
  const passThreshold = await getNumberSetting(db, SETTING_KEYS.aiPassThreshold);
  return {
    enabled: enabled !== false,
    baseUrl: (baseUrl ?? "").trim() || AI_DEFAULT_BASE_URL,
    apiKey: (apiKey ?? "").trim(),
    model: (model ?? "").trim() || AI_DEFAULT_MODEL,
    passThreshold:
      passThreshold != null && passThreshold >= 0 && passThreshold <= 100
        ? Math.round(passThreshold)
        : AI_DEFAULT_PASS_THRESHOLD,
  };
}

export function aiConfigured(cfg: AiConfig): boolean {
  return cfg.enabled && Boolean(cfg.apiKey) && Boolean(cfg.model);
}

/** Strip trailing slashes so `${base}/api/chat` composes cleanly. */
function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/chat`;
}

const SYSTEM_PROMPT = `You are a marketplace listing evaluator. You receive the user's evaluation criteria and exactly one listing. Score how well the listing matches the criteria.

Respond with JSON only, in exactly this shape:
{"score": 85, "reason": "one short sentence"}

Rules:
- "score" is an integer from 0 to 100: 100 = perfect match, 70-99 = good match, 40-69 = partial match with notable issues, 1-39 = poor match, 0 = clearly irrelevant.
- If information is missing or you are unsure, give a lower score rather than an optimistic one.
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

function normalizeVerdict(content: string, passThreshold: number): AiVerdict {
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

  // Preferred: numeric score 0-100
  let score: number | null = null;
  const rawScore = obj.score;
  if (typeof rawScore === "number" && Number.isFinite(rawScore)) {
    score = Math.round(rawScore);
  } else if (typeof rawScore === "string" && Number.isFinite(Number(rawScore.trim()))) {
    score = Math.round(Number(rawScore.trim()));
  }

  // Legacy tolerance: boolean "pass" only → map to a coarse score
  let legacyPass: boolean | null = null;
  const rawPass = obj.pass ?? obj.verdict ?? obj.match;
  if (typeof rawPass === "boolean") {
    legacyPass = rawPass;
  } else if (typeof rawPass === "string") {
    const v = rawPass.trim().toLowerCase();
    if (["true", "pass", "yes", "match", "matches", "igen"].includes(v)) legacyPass = true;
    else if (["false", "fail", "no", "no match", "does not match", "nem"].includes(v))
      legacyPass = false;
  }

  if (score == null && legacyPass == null) {
    throw new Error('Model output missing numeric "score"');
  }
  if (score == null) score = legacyPass ? 70 : 20;
  score = Math.min(100, Math.max(0, score));

  const pass = score >= passThreshold;

  const rawReason = obj.reason ?? obj.explanation ?? obj.why;
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!pass && !reason) {
    throw new Error(`Model output missing "reason" for a failing score (${score})`);
  }
  return { score, pass, reason: reason.slice(0, 500) };
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
  return normalizeVerdict(content, cfg.passThreshold);
}

const PRODUCT_QUERY_SYSTEM_PROMPT = `You extract a concise product search query for Árukereső.hu, a Hungarian price-comparison site.
You receive one marketplace listing. Return the product name a shop would use for the exact item.

Respond with JSON only, in exactly this shape:
{"query": "Brand exact model with important variant"}

Rules:
- Prefer the shortest manufacturer/model designation: brand + exact model name/number.
- Include a generic product type ONLY when the listing has no usable model number/name.
- Include important variants that are part of the model (storage, capacity, size), but NOT secondary specs such as battery Ah, blade/disc dimensions, weight, voltage unless voltage is part of the model name.
- Remove seller/marketing words, condition, location, price, delivery, warranty and included accessories.
- Do not translate. Keep the original product language (usually Hungarian or English).
- If the listing is an accessory (case, cable, charger, battery, spare part), keep the accessory word.
- If there is no identifiable product, return {"query": ""}.
- Keep the query under 80 characters.`;

type ProductQueryRow = Pick<
  typeof listings.$inferSelect,
  "name" | "details" | "lastPrice" | "engineSlug" | "url"
>;

/**
 * Ask the configured AI model for a clean product search query.
 * Returns null when AI is disabled/unconfigured or the model identifies no product.
 */
export async function extractProductQuery(
  cfg: AiConfig,
  row: ProductQueryRow,
): Promise<string | null> {
  if (!aiConfigured(cfg)) return null;

  const details = (row.details ?? null) as ListingItemDetails | null;
  const description =
    typeof details?.description === "string" ? details.description.trim() : "";
  const attributes =
    details?.attributes && Object.keys(details.attributes).length > 0
      ? Object.entries(details.attributes)
          .slice(0, 12)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join("\n")
      : "";

  const lines = [
    "LISTING:",
    `Title: ${row.name}`,
    row.lastPrice != null ? `Price: ${row.lastPrice} Ft` : null,
    `Engine: ${row.engineSlug}`,
    description ? `Description: ${description.slice(0, 1200)}` : null,
    attributes ? `Attributes:\n${attributes}` : null,
  ].filter((l): l is string => l != null && l !== "");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const res = await fetch(chatUrl(cfg.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: PRODUCT_QUERY_SYSTEM_PROMPT },
        { role: "user", content: lines.join("\n") },
      ],
      stream: false,
      format: "json",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI product query failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as ParsedChatResponse;
  let content = (data.message?.content ?? "").trim();
  if (!content) return null;

  const fence = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) content = fence[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const raw = (parsed as Record<string, unknown>).query;
  if (typeof raw !== "string") return null;
  const query = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  return query || null;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function percentOf(part: number | null, total: number | null): number | null {
  if (part == null || total == null || total <= 0) return null;
  return Math.round(Math.min(100, Math.max(0, (part / total) * 100)) * 10) / 10;
}

/**
 * Fetch Ollama Cloud balance + usage for the configured API key.
 * Other Ollama-compatible endpoints may not implement these routes; the
 * response then reports `ok: false` with a short detail instead of failing.
 */
export async function fetchAiUsage(
  cfg: Pick<AiConfig, "baseUrl" | "apiKey">,
): Promise<AiUsageResponse> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const fetchedAt = new Date().toISOString();
  if (!base) return { ok: false, detail: "Base URL is empty", fetchedAt };

  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const [balanceResult, usageResult] = await Promise.allSettled([
    fetch(`${base}/api/balance`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    }),
    fetch(`${base}/api/usage?range=30d&group_by=model`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    }),
  ]);

  const errors: string[] = [];
  let balance: Record<string, unknown> | null = null;
  let usage: Record<string, unknown> | null = null;

  if (balanceResult.status === "fulfilled") {
    const res = balanceResult.value;
    if (res.ok) {
      balance = asRecord(await res.json().catch(() => null));
    } else {
      errors.push(`balance HTTP ${res.status}`);
    }
  } else {
    errors.push(`balance: ${String(balanceResult.reason).slice(0, 120)}`);
  }

  if (usageResult.status === "fulfilled") {
    const res = usageResult.value;
    if (res.ok) {
      usage = asRecord(await res.json().catch(() => null));
    } else {
      errors.push(`usage HTTP ${res.status}`);
    }
  } else {
    errors.push(`usage: ${String(usageResult.reason).slice(0, 120)}`);
  }

  const out: AiUsageResponse = {
    ok: Boolean(balance || usage),
    fetchedAt,
  };
  if (!out.ok) {
    out.detail = errors.join(" · ") || "Usage is not available for this endpoint";
    return out;
  }

  const included = asRecord(balance?.included);
  if (included) {
    const includedBalance = asNumber(included.balance_usd);
    const allowance = asNumber(included.allowance_usd);
    const period = asRecord(included.period);
    out.includedBalanceUsd = includedBalance;
    out.includedAllowanceUsd = allowance;
    out.remainingPct = percentOf(includedBalance, allowance);
    out.usedPct =
      out.remainingPct != null
        ? Math.round((100 - out.remainingPct) * 10) / 10
        : null;
    out.periodFrom = asString(period?.from);
    out.periodUntil = asString(period?.until);

    const session = asRecord(included.session);
    const weekly = asRecord(included.weekly);
    out.sessionRemainingPct = asNumber(session?.remaining_percent);
    out.sessionResetsAt = asString(session?.resets_at);
    out.weeklyRemainingPct = asNumber(weekly?.remaining_percent);
    out.weeklyResetsAt = asString(weekly?.resets_at);
  }

  out.purchasedBalanceUsd = asNumber(asRecord(balance?.purchased)?.balance_usd);

  const totals = asRecord(usage?.totals);
  if (totals) {
    out.usage30d = {
      requests: asNumber(totals.request_count) ?? 0,
      usd: asNumber(totals.usage_usd) ?? 0,
      inputTokens: asNumber(totals.input_tokens) ?? 0,
      cachedInputTokens: asNumber(totals.cached_input_tokens) ?? 0,
      outputTokens: asNumber(totals.output_tokens) ?? 0,
    };

    const groups = Array.isArray(totals.groups) ? totals.groups : [];
    out.models = groups
      .map(asRecord)
      .filter((g): g is Record<string, unknown> => g != null)
      .map(
        (g): AiUsageModel => ({
          model: asString(g.model) ?? "unknown",
          requests: asNumber(g.request_count) ?? 0,
          usd: asNumber(g.usage_usd) ?? 0,
          inputTokens: asNumber(g.input_tokens) ?? 0,
          outputTokens: asNumber(g.output_tokens) ?? 0,
        }),
      )
      .slice(0, 5);
  }

  if (errors.length > 0) out.detail = errors.join(" · ");
  return out;
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

  // Not a match → hide it like a dismissed listing, so it disappears from the
  // potential-products feed. Never overwrite a timestamp the user already set.
  const autoHide = !verdict.pass && !row.notInterested;
  // A re-evaluation that now passes re-opens listings hidden by a previous
  // AI fail. User-dismissed listings stay dismissed.
  const autoRestore = verdict.pass && row.notInterested && row.notInterestedReason === "ai";

  await db
    .update(listings)
    .set({
      aiVerdict: verdict.pass ? "pass" : "fail",
      aiScore: verdict.score,
      aiReason: verdict.reason,
      aiModel: cfg.model,
      aiEvaluatedAt: now,
      updatedAt: now,
      ...(autoHide
        ? { notInterested: true, notInterestedAt: now, notInterestedReason: "ai" }
        : {}),
      ...(autoRestore
        ? { notInterested: false, notInterestedAt: null, notInterestedReason: null }
        : {}),
    })
    .where(eq(listings.id, row.id));

  if (autoHide) {
    log("AI", `auto-hidden ${row.engineSlug} ${row.id} (score ${verdict.score})`);
  } else if (autoRestore) {
    log("AI", `auto-restored ${row.engineSlug} ${row.id} (score ${verdict.score})`);
  }

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
      log("AI", `${verdict.pass ? "pass" : "fail"}(${verdict.score}) ${row.engineSlug} ${row.id}`);
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
