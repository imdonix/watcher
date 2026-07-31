import type { Page } from "playwright";
import {
  buildHasznaltautoSearchUrl,
  cyrb53,
  ENGINE_SLUGS,
  type ListingItemDetails,
  type ScrapedItem,
} from "@watcher/shared";
import { absoluteUrl, humanDelay, parsePriceHu } from "../lib/util";
import { gotoSmart } from "../browser";
import { dismissConsent } from "../lib/consent";
import type { EngineItemScrapeResult, EngineScraper } from "./types";
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

async function scrapeAutoItem(page: Page, url: string): Promise<EngineItemScrapeResult> {
  await gotoSmart(page, url);
  await dismissConsent(page);
  try {
    await page.waitForSelector("h1, .adatlap-cim, .cj-title, .car-title", { timeout: 12_000 });
  } catch {
    /* parse anyway */
  }

  const raw = await page.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      el?.textContent?.replace(/\s+/g, " ").trim() || "";

    const name =
      text(document.querySelector("h1")) ||
      text(document.querySelector(".adatlap-cim, .cj-title, .car-title")) ||
      document.title.split("|")[0]?.trim() ||
      "";

    const priceText =
      text(document.querySelector(".vetelar, .pricefield-primary, [class*='vetelar']")) ||
      text(document.querySelector(".price, [itemprop='price']")) ||
      null;

    let description =
      text(document.querySelector("#leiras, .leiras, .description, [itemprop='description']")) ||
      text(document.querySelector(".adatlap-leiras, .car-description")) ||
      "";
    if (!description) {
      description = Array.from(document.querySelectorAll("main p, .content p, article p"))
        .map((p) => text(p))
        .filter((t) => t.length > 30)
        .slice(0, 10)
        .join("\n\n");
    }

    const attributes: Record<string, string> = {};
    for (const row of Array.from(
      document.querySelectorAll(
        "table.adatlap-tablazat tr, .parameterek tr, table tr, .data-list li, dl > div",
      ),
    )) {
      const cells = row.querySelectorAll("td, th, span, strong, dt, dd");
      if (cells.length >= 2) {
        const k = text(cells[0]);
        const v = text(cells[1]);
        if (k && v && k.length < 80 && v.length < 200 && k !== v) attributes[k] = v;
      } else {
        const full = text(row);
        const m = full.match(/^([^:]+):\s*(.+)$/);
        if (m) attributes[m[1].trim()] = m[2].trim();
      }
    }

    const images: string[] = [];
    const seen = new Set<string>();
    for (const img of Array.from(
      document.querySelectorAll<HTMLImageElement>(
        ".gallery img, .carousel img, #kepek img, [class*='gallery'] img, main img, .adatlap img",
      ),
    )) {
      const src =
        img.getAttribute("data-lazyurl") ||
        img.getAttribute("data-src") ||
        img.currentSrc ||
        img.src ||
        "";
      if (!src || src.startsWith("data:") || /logo|icon|sprite|pixel/i.test(src)) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      images.push(src);
      if (images.length >= 12) break;
    }

    return { name, priceText, description, attributes, images };
  });

  const price = parsePriceHu(raw.priceText != null ? String(raw.priceText) : null);
  const details: ListingItemDetails = {
    description: raw.description ? String(raw.description).slice(0, 8000) : null,
    images: Array.isArray(raw.images) ? (raw.images as string[]) : [],
    attributes: (raw.attributes as Record<string, string>) || {},
    extra: { source: "hasznaltauto.item", priceText: raw.priceText },
  };

  if (!raw.name && !details.description && details.images!.length === 0) {
    return { details: null, error: "Could not parse hasznaltauto item page" };
  }

  return {
    details,
    name: raw.name ? String(raw.name) : null,
    price,
    image: details.images?.[0] ?? null,
  };
}

export const autoEngine: EngineScraper = {
  slug: ENGINE_SLUGS.auto,
  name: "hasznaltauto.hu",

  async scrapeItem(page, input) {
    log("auto", `item: ${input.url}`);
    return scrapeAutoItem(page, input.url);
  },

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
