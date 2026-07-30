import type { Page } from "playwright";
import {
  buildHasznaltautoSearchUrl,
  cyrb53,
  ENGINE_SLUGS,
  type ScrapedItem,
} from "@watcher/shared";
import { absoluteUrl, humanDelay, parsePriceHu } from "../lib/util";
import { gotoSmart } from "../browser";
import { dismissConsent } from "../lib/consent";
import type { EngineScraper } from "./types";
import { log } from "../lib/log";

async function extractListings(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const cards = document.querySelectorAll(
      ".talalati-sor, .row.talalati-sor, [class*='talalat'], article.listing, .list-item",
    );

    for (const el of Array.from(cards)) {
      try {
        const root = el as HTMLElement;
        const titleEl = root.querySelector("h3 a, h2 a, h3, a.talalati-title");
        const name =
          (titleEl as HTMLElement | null)?.innerText?.trim() ||
          titleEl?.textContent?.trim() ||
          "";
        const imgEl = root.querySelector(
          "img.img-responsive, img[data-lazyurl], img[data-src], img",
        ) as HTMLImageElement | null;
        const image =
          imgEl?.getAttribute("data-lazyurl") ||
          imgEl?.getAttribute("data-src") ||
          imgEl?.src ||
          null;
        const linkEl =
          (root.querySelector("h3 a, a[href*='hasznaltauto.hu']") as HTMLAnchorElement | null) ||
          (imgEl?.closest("a") as HTMLAnchorElement | null);
        const href = linkEl?.href || null;
        const priceText =
          root.querySelector(".vetelar, .pricefield-primary, [class*='price']")?.textContent?.trim() ||
          null;
        const ad = Boolean(
          root.querySelector(".label-hasznaltauto, .kiemeit, .promoted, [class*='kiemelt']"),
        );

        if (!name && !href) continue;
        out.push({ name, image, href, priceText, ad });
      } catch {
        /* skip */
      }
    }
    return out;
  });
}

export const autoEngine: EngineScraper = {
  slug: ENGINE_SLUGS.auto,
  name: "hasznaltauto.hu",

  async scrape(page, routine) {
    const depth = Math.min(Number(routine.depth) || 2, 10);
    const items: ScrapedItem[] = [];
    let pagesFetched = 0;
    let pagesFailed = 0;

    if (!buildHasznaltautoSearchUrl(routine, 1)) {
      throw new Error("hasznaltauto.hu requires routine.key (search key from results URL)");
    }

    for (let p = 1; p <= depth; p++) {
      const url = buildHasznaltautoSearchUrl(routine, p)!;
      log("auto", `page ${p}: ${url}`);
      try {
        await gotoSmart(page, url);
        await dismissConsent(page);

        const raw = await extractListings(page);
        pagesFetched++;
        if (raw.length === 0) {
          log("auto", `no items on page ${p}, stopping`);
          break;
        }

        for (const r of raw) {
          const itemUrl = absoluteUrl("https://www.hasznaltauto.hu", String(r.href ?? ""));
          if (!itemUrl) continue;
          const price = parsePriceHu(r.priceText != null ? String(r.priceText) : null);

          items.push({
            id: String(cyrb53(`${itemUrl}-${ENGINE_SLUGS.auto}`)),
            name: String(r.name || "Untitled"),
            price,
            url: itemUrl,
            image: r.image ? String(r.image) : null,
            ad: Boolean(r.ad),
          });
        }

        await humanDelay(1500, 3200);
      } catch (err) {
        pagesFailed++;
        log("auto", `page ${p} failed: ${err}`);
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
