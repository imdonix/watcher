import { createMiddleware } from "hono/factory";
import { env, tokensMatch } from "../env";

export type AuthEnv = {
  Variables: Record<string, never>;
};

function extractToken(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  if (header?.startsWith("Token ")) {
    return header.slice(6).trim();
  }

  // Optional: X-API-Token header
  const x = c.req.header("X-API-Token");
  if (x?.trim()) return x.trim();

  // Cookie fallback for browser
  const cookie = c.req.header("Cookie");
  if (cookie) {
    for (const part of cookie.split(";").map((p) => p.trim())) {
      if (part.startsWith("token=")) {
        return decodeURIComponent(part.slice(6));
      }
    }
  }

  return null;
}

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = extractToken(c);
  if (!token || !tokensMatch(token, env.apiToken)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
