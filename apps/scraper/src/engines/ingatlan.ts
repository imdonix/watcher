import type { Page } from "playwright";
import {
  buildIngatlanSearchPath,
  buildIngatlanSearchUrl,
  cyrb53,
  ENGINE_SLUGS,
  type ScrapedItem,
} from "@watcher/shared";
import { absoluteUrl, humanDelay, parsePriceHu } from "../lib/util";
import { gotoSmart } from "../browser";
import { dismissConsent } from "../lib/consent";
import type { EngineScraper } from "./types";
import { log } from "../lib/log";

const BASE = "https://ingatlan.com";

async function extractListings(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const cards = document.querySelectorAll(
      ".listing, .listing-card, [data-listing-id], .result-item, article[class*='listing']",
    );

    for (const el of Array.from(cards)) {
      try {
        const root = el as HTMLElement;
        const link = root.querySelector(
          "a.listing__link, a[href*='/'], a.listing-card__link",
        ) as HTMLAnchorElement | null;
        const href = link?.getAttribute("href") || null;
        const img = (
          root.querySelector(
            "img.listing__image, img[src*='ingatlan'], img",
          ) as HTMLImageElement | null
        )?.src;
        const where =
          root.querySelector(
            ".listing__address, .listing-card__address, [class*='address']",
          )?.textContent?.trim() || "";
        const priceText =
          root.querySelector(".price, .listing-card__price, [class*='price']")?.textContent?.trim() ||
          null;
        const areaText =
          root
            .querySelector(
              ".listing__data--area-size, [class*='area'], .listing-card__parameter",
            )
            ?.textContent?.trim() || null;

        if (!href && !where) continue;
        out.push({ href, image: img, where, priceText, areaText });
      } catch {
        /* skip */
      }
    }

    if (out.length === 0) {
      for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
        try {
          const data = JSON.parse(script.textContent || "null");
          const list = Array.isArray(data) ? data : data?.["@graph"] || [data];
          for (const node of list) {
            const t = node?.["@type"];
            if (t === "Offer" || t === "Product" || node?.url) {
              out.push({
                href: node.url,
                image: node.image,
                where: node.name || node.description,
                priceText: node.offers?.price || node.price,
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

export const ingatlanEngine: EngineScraper = {
  slug: ENGINE_SLUGS.ingatlan,
  name: "ingatlan.com",

  async scrape(page, routine) {
    const searchPath = buildIngatlanSearchPath(routine);
    const depth = Math.min(Number(routine.depth) || 3, 10);
    const items: ScrapedItem[] = [];
    let pagesFetched = 0;
    let pagesFailed = 0;

    if (!searchPath || !buildIngatlanSearchUrl(routine)) {
      throw new Error("ingatlan.com: empty search path — set listing type / location or advanced path");
    }

    for (let p = 1; p <= depth; p++) {
      const base = buildIngatlanSearchUrl(routine)!;
      const url = `${base}${base.includes("?") ? "&" : "?"}page=${p}`;
      log("ingatlan", `page ${p}: ${url}`);
      try {
        await gotoSmart(page, url);
        await dismissConsent(page);

        const raw = await extractListings(page);
        pagesFetched++;
        if (raw.length === 0) {
          log("ingatlan", `no items on page ${p}, stopping (complete empty page)`);
          break;
        }

        for (const r of raw) {
          const itemUrl = absoluteUrl(BASE, String(r.href ?? ""));
          if (!itemUrl) continue;
          const where = String(r.where || "");
          const price = parsePriceHu(r.priceText != null ? String(r.priceText) : null);
          let area: number | null = null;
          if (r.areaText) {
            const m = String(r.areaText).match(/(\d+)/);
            area = m ? Number(m[1]) : null;
          }

          items.push({
            id: String(cyrb53(`${itemUrl}-${ENGINE_SLUGS.ingatlan}`)),
            name: where || itemUrl,
            where,
            price,
            area,
            url: itemUrl,
            image: r.image ? String(r.image) : null,
          });
        }

        await humanDelay(1200, 2800);
      } catch (err) {
        pagesFailed++;
        log("ingatlan", `page ${p} failed: ${err}`);
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
