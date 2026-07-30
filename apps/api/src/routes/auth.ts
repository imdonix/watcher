import { Hono } from "hono";
import { env, tokensMatch } from "../env";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { log } from "../lib/time";

/**
 * Single-admin token auth.
 * The only credential is the service API token (env API_TOKEN or generated at boot).
 */
export function authRoutes() {
  const app = new Hono<AuthEnv>();

  /** Validate a token and return ok (used by the SPA login form). */
  app.post("/login", async (c) => {
    const body = await c.req.json<{ token?: string; password?: string; pass?: string }>().catch(() => ({}));
    // Accept token field; also allow password/pass aliases for convenience
    const provided = String(
      (body as { token?: string }).token ??
        (body as { password?: string }).password ??
        (body as { pass?: string }).pass ??
        "",
    ).trim();

    if (!provided || !tokensMatch(provided, env.apiToken)) {
      return c.json({ error: "Invalid API token" }, 401);
    }

    log("API", "Token login OK");
    return c.json({ ok: true, token: env.apiToken });
  });

  /** Confirm the current Bearer token is valid. */
  app.get("/me", requireAuth, async (c) => {
    return c.json({ ok: true, role: "admin" });
  });

  return app;
}
