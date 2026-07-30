import type { Page } from "playwright";
import {
  buildJofogasSearchUrl,
  cyrb53,
  ENGINE_SLUGS,
  type ScrapedItem,
} from "@watcher/shared";
import { absoluteUrl, humanDelay, parsePriceHu } from "../lib/util";
import { dismissConsent } from "../lib/consent";
import { gotoSmart } from "../browser";
import type { EngineScraper } from "./types";
import { log } from "../lib/log";

async function extractItems(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const results: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    // Modern MUI layout (2024+)
    const modernCards = Array.from(
      document.querySelectorAll('[data-testid="ad-card-general"]'),
    );

    // Legacy list-item layout
    const legacyCards = Array.from(
      document.querySelectorAll(".list-item, [data-testid='list-item']"),
    );

    const cards = modernCards.length > 0 ? modernCards : legacyCards;

    for (const el of cards) {
      try {
        const root = el as HTMLElement;

        const linkEl = root.querySelector(
          "a[href*='.htm'], a.MuiLink-root",
        ) as HTMLAnchorElement | null;
        const url = linkEl?.href || null;
        if (!url || seen.has(url)) continue;
        if (!/\.htm/i.test(url) && !/hirdetes/i.test(url)) continue;
        seen.add(url);

        // Title lives in h5 on modern cards (price is h2 — do not use generic h2)
        const titleEl = root.querySelector(
          "h5.MuiTypography-h5, h5, [data-testid='ad-title']",
        );
        let name = titleEl?.textContent?.trim() || "";
        if (!name) {
          name =
            (root.innerText || "")
              .split("\n")
              .map((s) => s.trim())
              .find((s) => s.length > 8 && !/^\d/.test(s)) || "";
        }

        // Price: dedicated h2 + "Ft" subtitle
        const priceH2 = root.querySelector("h2.MuiTypography-h2, h2");
        const priceText = priceH2?.textContent?.trim()
          ? `${priceH2.textContent.trim()} Ft`
          : null;

        const img =
          (root.querySelector("img") as HTMLImageElement | null)?.src ||
          (root.querySelector("img") as HTMLImageElement | null)?.getAttribute("data-src");

        const fullText = root.innerText || "";
        const company =
          /üzleti felhasználó|bolt\s*\(/i.test(fullText) ||
          Boolean(root.querySelector(".badge-company_ad, [data-testid='company-badge']"));
        // Legacy "post service" badge only (not generic shipping icons)
        const post = Boolean(root.querySelector(".badge-box, [data-testid='post-badge']"));

        const idMatch = url.match(/_(\d+)\.htm/i);
        const rawId = idMatch?.[1] || url;

        results.push({
          rawId,
          name,
          priceText,
          image: img,
          url,
          company,
          post,
        });
      } catch {
        /* skip */
      }
    }

    // Meta-based legacy fallback
    if (results.length === 0) {
      for (const root of legacyCards) {
        try {
          const el = root as HTMLElement;
          const meta = Array.from(el.querySelectorAll("meta")).map((m) => ({
            itemprop: m.getAttribute("itemprop"),
            content: m.getAttribute("content"),
          }));
          const urlMeta = meta.find((m) => m.itemprop === "url")?.content;
          const nameMeta = meta.find((m) => m.itemprop === "name")?.content;
          const linkEl = el.querySelector("a.subject, a[href]") as HTMLAnchorElement | null;
          const url = urlMeta || linkEl?.href;
          if (!url || seen.has(url)) continue;
          seen.add(url);
          const priceEl = el.querySelector(".price-value, [itemprop='price']");
          results.push({
            rawId: urlMeta?.includes("#") ? urlMeta.slice(urlMeta.indexOf("#") + 1) : url,
            name: nameMeta || linkEl?.textContent?.trim() || "",
            priceText: priceEl?.getAttribute("content") || priceEl?.textContent,
            image: (el.querySelector("img") as HTMLImageElement | null)?.src,
            url,
            company: Boolean(el.querySelector(".badge-company_ad")),
            post: Boolean(el.querySelector(".badge-box")),
          });
        } catch {
          /* */
        }
      }
    }

    return results;
  });
}

async function nextPageUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const next =
      (document.querySelector(
        "a.ad-list-pager-item-next, a[rel='next'], .MuiPagination-ul li:last-child a, button[aria-label='Go to next page']",
      ) as HTMLAnchorElement | null) || null;
    if (next?.href) return next.href;
    // MUI pagination: find active + next sibling
    const active = document.querySelector(
      ".MuiPaginationItem-page.Mui-selected, .Mui-selected[aria-current='true']",
    );
    const nextBtn = active?.parentElement?.nextElementSibling?.querySelector("a, button");
    if (nextBtn instanceof HTMLAnchorElement) return nextBtn.href;
    return null;
  });
}

export const jofogasEngine: EngineScraper = {
  slug: ENGINE_SLUGS.jofogas,
  name: "jofogas.hu",

  async scrape(page, routine) {
    const domain = String(routine.domain || "https://www.jofogas.hu/magyarorszag");
    const minPrice =
      routine.minPrice != null && routine.minPrice !== "" ? Number(routine.minPrice) : null;
    const maxPrice =
      routine.maxPrice != null && routine.maxPrice !== "" ? Number(routine.maxPrice) : null;
    const enableCompany = Boolean(routine.enableCompany);
    const enablePost = Boolean(routine.enablePost);
    const depth = Math.min(Number(routine.depth) || 5, 15);

    let url = buildJofogasSearchUrl(routine);
    const items: ScrapedItem[] = [];
    let pagesFetched = 0;
    let pagesFailed = 0;

    for (let pageNum = 0; pageNum < depth && url; pageNum++) {
      log("jofogas", `page ${pageNum + 1}: ${url}`);
      try {
        await gotoSmart(page, url);
        await dismissConsent(page);
        try {
          await page.waitForSelector(
            '[data-testid="ad-card-general"], .MuiCard-root, .list-item',
            { timeout: 12_000 },
          );
        } catch {
          log("jofogas", "no cards selector timed out (page still counts if HTML loaded)");
        }

        const raw = await extractItems(page);
        pagesFetched++;
        log("jofogas", `raw cards: ${raw.length}`);

        for (const r of raw) {
          const price =
            r.priceText != null ? parsePriceHu(String(r.priceText)) : null;

          if (minPrice != null && price != null && price < minPrice) continue;
          if (maxPrice != null && price != null && price > maxPrice) continue;
          if (!enableCompany && r.company) continue;
          if (!enablePost && r.post) continue;

          const itemUrl = absoluteUrl(domain, String(r.url ?? "")) || String(r.url);
          const idSeed = String(r.rawId ?? itemUrl);
          items.push({
            id: String(cyrb53(`${idSeed}-${ENGINE_SLUGS.jofogas}`)),
            name: String(r.name || "Untitled"),
            price,
            url: itemUrl,
            image: r.image ? String(r.image) : null,
            company: Boolean(r.company),
            post: Boolean(r.post),
          });
        }

        const next = await nextPageUrl(page);
        if (!next || next === url) break;
        url = next;
        await humanDelay(1000, 2500);
      } catch (err) {
        pagesFailed++;
        log("jofogas", `page failed: ${err}`);
        // Stop pagination — incomplete run
        break;
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
