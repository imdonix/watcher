import type { BrowserContext, Page } from "playwright";
import {
  buildIngatlanSearchPath,
  buildIngatlanSearchUrl,
  cyrb53,
  ENGINE_SLUGS,
  type ListingItemDetails,
  type ScrapedItem,
} from "@watcher/shared";
import { absoluteUrl, humanDelay, parsePriceHu, randomBetween } from "../lib/util";
import { dismissConsent } from "../lib/consent";
import { gotoSmart } from "../browser";
import type { EngineItemScrapeResult, EngineScraper } from "./types";
import { log } from "../lib/log";

const BASE = "https://ingatlan.com";
/** Full result page size on lista views — fewer cards means last page. */
const PAGE_SIZE = 20;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

/**
 * Cloudflare on ingatlan.com rate-limits/blocks page≥2 when the same browser
 * context reuses cookies after page 1. A fresh context per list page works.
 */
async function openListingContext(seedPage: Page): Promise<BrowserContext> {
  const browser = seedPage.context().browser();
  if (!browser) {
    throw new Error("ingatlan: no browser handle for fresh context");
  }
  const ua = USER_AGENTS[randomBetween(0, USER_AGENTS.length - 1)];
  const context = await browser.newContext({
    userAgent: ua,
    locale: "hu-HU",
    timezoneId: "Europe/Budapest",
    viewport: { width: 1366 + randomBetween(0, 200), height: 768 + randomBetween(0, 200) },
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      "Accept-Language": "hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-expect-error chrome stub
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", {
      get: () => ["hu-HU", "hu", "en-US", "en"],
    });
  });
  return context;
}

function isBlockedTitle(title: string): boolean {
  return /nem elérhető|ellenőrzés|just a quick check|captcha|access denied|unavailable/i.test(
    title,
  );
}

/**
 * Listing cards on modern ingatlan.com are themselves <a class="listing-card">,
 * not containers with nested listing__link anchors.
 */
async function extractListings(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a.listing-card[href], a[data-listing-id], [data-listing-id], .listing-card",
      ),
    );

    for (const root of cards) {
      try {
        const dataId =
          root.getAttribute("data-listing-id") ||
          root.getAttribute("data-id") ||
          root.getAttribute("id") ||
          "";

        let href: string | null = null;
        if (root instanceof HTMLAnchorElement && root.getAttribute("href")) {
          href = root.getAttribute("href");
        } else {
          const nested = root.querySelector<HTMLAnchorElement>(
            "a.listing__link, a.listing-card__link, a[href^='/'], a[href*='ingatlan.com']",
          );
          href = nested?.getAttribute("href") || null;
        }
        if (!href && dataId && /^\d+$/.test(dataId)) {
          href = `/${dataId}`;
        }
        if (!href) continue;

        // Skip nav / non-listing anchors
        if (/^#|^javascript:|\/(lista|szukites)\//i.test(href) && !dataId) continue;

        const key = dataId || href;
        if (seen.has(key)) continue;
        seen.add(key);

        // Prefer dedicated price nodes; card text starts with photo-count + price
        const priceEl = root.querySelector<HTMLElement>(
          "[class*='price'], [class*='Price'], .listing-card-price, .fs-5, .fs-4",
        );
        let priceText =
          priceEl?.textContent?.replace(/\s+/g, " ").trim() ||
          null;

        const fullText = (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim();

        // "180 000 Ft/hó" or "45.5 M Ft" — avoid leading badge numbers (photo count)
        if (!priceText || !/Ft|€|EUR|millió|ezer/i.test(priceText)) {
          const m =
            fullText.match(/(\d[\d.\s]*\d|\d)\s*(?:millió\s*)?Ft(?:\s*\/\s*hó)?/i) ||
            fullText.match(/(\d+[.,]\d+)\s*M(?:\s*Ft)?/i);
          if (m) priceText = m[0];
        }

        // Address: "Szeged, Püspök utca 9."
        let where =
          root
            .querySelector<HTMLElement>(
              "[class*='address'], [class*='Address'], [class*='location'], .listing-card-address",
            )
            ?.textContent?.replace(/\s+/g, " ")
            .trim() || "";

        if (!where) {
          const addr = fullText.match(
            /([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű.]+)*,\s*[^|]+?)(?:\s+Alapterület|\s+Szobák|\s+\d+\s*m2|$)/,
          );
          if (addr) where = addr[1].trim();
        }

        let areaText =
          root
            .querySelector<HTMLElement>(
              "[class*='area'], [class*='Area'], [class*='parameter']",
            )
            ?.textContent?.trim() || null;
        if (!areaText) {
          const am = fullText.match(/Alapterület\s*([\d\s]+)\s*m/i) || fullText.match(/(\d+)\s*m2/i);
          if (am) areaText = am[0];
        }

        const img =
          root.querySelector<HTMLImageElement>("img[src], img[data-src], img[data-lazy]") || null;
        const image =
          img?.getAttribute("src") ||
          img?.getAttribute("data-src") ||
          img?.getAttribute("data-lazy") ||
          null;

        out.push({
          href,
          listingId: dataId || null,
          image,
          where,
          priceText,
          areaText,
          nameHint: where || fullText.slice(0, 80),
        });
      } catch {
        /* skip card */
      }
    }

    // Fallback: JSON-LD
    if (out.length === 0) {
      for (const script of Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      )) {
        try {
          const data = JSON.parse(script.textContent || "null");
          const list = Array.isArray(data) ? data : data?.["@graph"] || [data];
          for (const node of list) {
            const t = node?.["@type"];
            if (t === "Offer" || t === "Product" || t === "Apartment" || node?.url) {
              out.push({
                href: node.url,
                image: typeof node.image === "string" ? node.image : node.image?.[0],
                where: node.name || node.description || "",
                priceText: node.offers?.price || node.price || null,
                areaText: null,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    return out;
  });
}

/** Wait until listing cards appear (or timeout). */
async function waitForResults(page: Page): Promise<number> {
  try {
    await page.waitForSelector("a.listing-card, a[data-listing-id], [data-listing-id]", {
      timeout: 12_000,
    });
  } catch {
    /* empty or blocked */
  }
  return page.locator("a.listing-card, a[data-listing-id], [data-listing-id]").count();
}

function parseArea(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Prefer price near Ft/hó; fall back to generic HU parse.
 *
 * Card text often starts with a photo-count badge, e.g.:
 *   "12 180 000 Ft/hó …"  → badge 12, rent 180 000
 * not 12_180_000.
 */
function parseListingPrice(priceText: string | null | undefined): number | null {
  if (!priceText) return null;
  const t = priceText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  // badge + monthly rent: "12 180 000 Ft/hó"
  const badgeRent = t.match(
    /(?:^|\s)(\d{1,2})\s+(\d{1,3}(?:[.\s]\d{3})+)\s*Ft\s*\/\s*hó/i,
  );
  if (badgeRent) {
    const badge = Number(badgeRent[1]);
    const price = Number(badgeRent[2].replace(/[.\s]/g, ""));
    if (badge <= 60 && price >= 15_000 && price <= 5_000_000) return price;
  }

  // clean monthly rent: "180 000 Ft/hó"
  const rent = t.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})\s*Ft\s*\/\s*hó/i);
  if (rent) {
    let n = Number(rent[1].replace(/[.\s]/g, ""));
    // If still inflated (badge glued on), peel 1–2 leading digits
    if (n > 5_000_000) {
      const s = String(n);
      for (const drop of [1, 2]) {
        const candidate = Number(s.slice(drop));
        if (candidate >= 15_000 && candidate <= 5_000_000) {
          n = candidate;
          break;
        }
      }
    }
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Sale with millions: "45,5 M Ft" / "45.5 millió"
  const mil = t.match(/(\d+[.,]\d+|\d+)\s*(?:M|millió)/i);
  if (mil) {
    const base = Number(mil[1].replace(",", "."));
    if (Number.isFinite(base)) return Math.round(base * 1_000_000);
  }

  // Plain sale: "12 500 000 Ft" (no /hó)
  if (!/\/\s*hó/i.test(t)) {
    const plain = t.match(/(\d{1,3}(?:[.\s]\d{3}){1,}|\d{6,})\s*Ft/i);
    if (plain) {
      const n = Number(plain[1].replace(/[.\s]/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return parsePriceHu(t);
}

async function scrapeIngatlanItem(page: Page, url: string): Promise<EngineItemScrapeResult> {
  await gotoSmart(page, url);
  await dismissConsent(page);
  try {
    await page.waitForSelector("h1, [class*='address'], .listing-title, main", {
      timeout: 12_000,
    });
  } catch {
    /* parse anyway */
  }

  const title = await page.title();
  if (isBlockedTitle(title)) {
    return { details: null, error: `ingatlan item blocked: ${title}` };
  }

  const raw = await page.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      el?.textContent?.replace(/\s+/g, " ").trim() || "";

    const name =
      text(document.querySelector("h1")) ||
      text(document.querySelector("[class*='address'], .listing-title, .property-title")) ||
      document.title.split("|")[0]?.trim() ||
      "";

    const priceText =
      text(
        document.querySelector(
          "[class*='price'], .listing-price, [data-testid*='price'], .fs-4, .fs-5",
        ),
      ) || null;

    let description =
      text(
        document.querySelector(
          "[class*='description'], #description, [data-testid*='description'], .listing-description",
        ),
      ) || "";
    if (!description) {
      description = Array.from(document.querySelectorAll("main p, article p, .content p"))
        .map((p) => text(p))
        .filter((t) => t.length > 40)
        .slice(0, 10)
        .join("\n\n");
    }

    const attributes: Record<string, string> = {};
    for (const row of Array.from(
      document.querySelectorAll(
        "table tr, .parameters tr, [class*='parameter'] li, dl > div, .listing-parameter, [class*='Param']",
      ),
    )) {
      const cells = row.querySelectorAll("td, th, dt, dd, span, strong");
      if (cells.length >= 2) {
        const k = text(cells[0]);
        const v = text(cells[1]);
        if (k && v && k.length < 80 && v.length < 200 && k !== v) attributes[k] = v;
      } else {
        const full = text(row);
        const m = full.match(/^([^:]+):\s*(.+)$/);
        if (m && m[1].length < 60) attributes[m[1].trim()] = m[2].trim();
      }
    }

    const images: string[] = [];
    const seen = new Set<string>();
    for (const img of Array.from(
      document.querySelectorAll<HTMLImageElement>(
        "img[src*='ingatlan'], .gallery img, [class*='gallery'] img, [class*='carousel'] img, main img",
      ),
    )) {
      const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
      if (!src || src.startsWith("data:") || /logo|icon|sprite|map/i.test(src)) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      images.push(src);
      if (images.length >= 12) break;
    }

    return { name, priceText, description, attributes, images };
  });

  const price = parseListingPrice(raw.priceText != null ? String(raw.priceText) : null);
  const details: ListingItemDetails = {
    description: raw.description ? String(raw.description).slice(0, 8000) : null,
    images: Array.isArray(raw.images) ? (raw.images as string[]) : [],
    attributes: (raw.attributes as Record<string, string>) || {},
    extra: { source: "ingatlan.item", priceText: raw.priceText },
  };

  if (!raw.name && !details.description && details.images!.length === 0) {
    return { details: null, error: "Could not parse ingatlan item page" };
  }

  return {
    details,
    name: raw.name ? String(raw.name) : null,
    price,
    image: details.images?.[0] ?? null,
  };
}

export const ingatlanEngine: EngineScraper = {
  slug: ENGINE_SLUGS.ingatlan,
  name: "ingatlan.com",

  async scrapeItem(page, input) {
    log("ingatlan", `item: ${input.url}`);
    return scrapeIngatlanItem(page, input.url);
  },

  async scrape(seedPage, routine) {
    const searchPath = buildIngatlanSearchPath(routine);
    const depth = Math.min(Number(routine.depth) || 3, 10);
    const items: ScrapedItem[] = [];
    let pagesFetched = 0;
    let pagesFailed = 0;

    if (!searchPath || !buildIngatlanSearchUrl(routine)) {
      throw new Error(
        "ingatlan.com: empty search path — set listing type / location or advanced path",
      );
    }

    log("ingatlan", `search path: ${searchPath}`);

    for (let p = 1; p <= depth; p++) {
      const base = buildIngatlanSearchUrl(routine)!;
      // page 1 works with or without ?page=1; higher pages need the param
      const url = p === 1 ? base : `${base}${base.includes("?") ? "&" : "?"}page=${p}`;
      log("ingatlan", `page ${p}: ${url}`);

      let context: BrowserContext | null = null;
      try {
        // Fresh context per page — same context gets CF 403 on page≥2
        context = await openListingContext(seedPage);
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        page.setDefaultNavigationTimeout(45_000);

        await humanDelay(400, 1100);
        const response = await page.goto(url, { waitUntil: "domcontentloaded" });
        await humanDelay(500, 1200);
        await dismissConsent(page);

        const status = response?.status() ?? 0;
        const title = await page.title();

        if (status === 403 || status === 429 || isBlockedTitle(title)) {
          // One retry with a brand-new context + longer pause
          log("ingatlan", `page ${p}: blocked (HTTP ${status}, "${title}") — retrying once`);
          await context.close().catch(() => undefined);
          context = null;
          await humanDelay(2500, 4500);

          context = await openListingContext(seedPage);
          const retryPage = await context.newPage();
          retryPage.setDefaultTimeout(45_000);
          const retryResp = await retryPage.goto(url, { waitUntil: "domcontentloaded" });
          await humanDelay(600, 1400);
          await dismissConsent(retryPage);

          const retryStatus = retryResp?.status() ?? 0;
          const retryTitle = await retryPage.title();
          if (retryStatus === 403 || retryStatus === 429 || isBlockedTitle(retryTitle)) {
            pagesFailed++;
            log(
              "ingatlan",
              `page ${p}: still blocked after retry (HTTP ${retryStatus}, "${retryTitle}") — stopping (incomplete)`,
            );
            break;
          }

          const cardCount = await waitForResults(retryPage);
          log("ingatlan", `page ${p}: ${cardCount} listing-card node(s) in DOM (retry)`);
          const raw = await extractListings(retryPage);
          pagesFetched++;
          log("ingatlan", `page ${p}: extracted ${raw.length} listing(s)`);

          if (raw.length === 0) {
            if (p === 1) {
              log("ingatlan", `no items on page 1 — done (empty result set)`);
            } else {
              log(
                "ingatlan",
                `page ${p} empty after page ${p - 1} had results — treating as past last page`,
              );
            }
            break;
          }
          pushItems(items, raw);
          if (raw.length < PAGE_SIZE) {
            log(
              "ingatlan",
              `page ${p}: ${raw.length} < ${PAGE_SIZE} — last page, stopping`,
            );
            break;
          }
          await humanDelay(1800, 3200);
          continue;
        }

        const cardCount = await waitForResults(page);
        log("ingatlan", `page ${p}: ${cardCount} listing-card node(s) in DOM`);

        const raw = await extractListings(page);
        pagesFetched++;
        log("ingatlan", `page ${p}: extracted ${raw.length} listing(s)`);

        if (raw.length === 0) {
          if (isBlockedTitle(title) || /nem tudod elérni|cloudflare/i.test(title)) {
            pagesFailed++;
            log("ingatlan", `page ${p}: empty + blocked title — incomplete`);
            break;
          }
          // Empty first page = no results. Empty later page = went past the end
          // (shouldn't happen if we stop on partial pages).
          if (p === 1) {
            const diag = await page.evaluate(() => ({
              title: document.title,
              bodyStart: document.body?.innerText?.slice(0, 160)?.replace(/\s+/g, " "),
              listingCard: document.querySelectorAll(".listing-card").length,
            }));
            log("ingatlan", `page 1 empty diag=${JSON.stringify(diag)}`);
          } else {
            log(
              "ingatlan",
              `page ${p} empty — past last page (should have stopped earlier)`,
            );
          }
          break;
        }

        pushItems(items, raw);

        // Full pages have PAGE_SIZE cards; a short page is the last one.
        if (raw.length < PAGE_SIZE) {
          log(
            "ingatlan",
            `page ${p}: ${raw.length} < ${PAGE_SIZE} — last page, stopping`,
          );
          break;
        }

        // Pause before next page to reduce CF friction
        await humanDelay(1800, 3500);
      } catch (err) {
        pagesFailed++;
        log("ingatlan", `page ${p} failed: ${err}`);
        break;
      } finally {
        if (context) await context.close().catch(() => undefined);
      }
    }

    const map = new Map(items.map((i) => [i.id, i]));
    return {
      items: [...map.values()],
      pagesPlanned: depth,
      pagesFetched,
      pagesFailed,
      complete: pagesFailed === 0 && pagesFetched > 0,
    };
  },
};

function pushItems(
  items: ScrapedItem[],
  raw: Array<Record<string, unknown>>,
): void {
  for (const r of raw) {
    const itemUrl = absoluteUrl(BASE, String(r.href ?? ""));
    if (!itemUrl) continue;
    if (!/ingatlan\.com\/\d+/i.test(itemUrl) && !r.listingId) {
      try {
        const path = new URL(itemUrl).pathname;
        if (!/^\/\d+/.test(path)) continue;
      } catch {
        continue;
      }
    }

    const where = String(r.where || r.nameHint || "");
    const price = parseListingPrice(r.priceText != null ? String(r.priceText) : null);
    const area = parseArea(r.areaText != null ? String(r.areaText) : null);
    const idSeed = r.listingId ? String(r.listingId) : itemUrl;

    items.push({
      id: String(cyrb53(`${idSeed}-${ENGINE_SLUGS.ingatlan}`)),
      name: where || itemUrl,
      where,
      price,
      area,
      url: itemUrl,
      image: r.image ? String(r.image) : null,
    });
  }
}
