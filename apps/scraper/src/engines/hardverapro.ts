import type { Page } from "playwright";
import {
  buildHardveraproSearchUrl,
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

const BASE = "https://hardverapro.hu";

/**
 * hardverapro serves list thumbnails with a trailing size segment
 * (`…/p_1234.jpg/100`); the full-size version is the same path without it.
 * After JS runs the `data-retina-url` attribute is gone, so we strip the size.
 */
function fullSizeImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const abs = absoluteUrl(BASE, url);
  if (!abs) return null;
  return abs.replace(/(\.[a-z0-9]{3,4})\/\d{1,4}$/i, "$1");
}

/**
 * Extract ads from a hardverapro.hu results page.
 *
 * Each ad is a server-rendered `<li class="media" data-uadid="…">` with a
 * title column (`.uad-col-title h1 a`), a price column
 * (`.uad-col-price .uad-price`), the seller (`.uad-user-text a`), cities
 * (`.uad-cities`) and a timestamp (`.uad-time time`). Featured ("Előresorolt")
 * and business ("Bazár") ads carry extra classes / ribbons.
 *
 * NOTE: everything inside page.evaluate() is serialized into the browser.
 */
async function extractListings(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("li.media[data-uadid], .uad-list li[data-uadid]"),
    );

    for (const root of rows) {
      try {
        const uadid = (root.getAttribute("data-uadid") || "").trim();

        const titleLink = root.querySelector<HTMLAnchorElement>(
          ".uad-col-title h1 a, .uad-col-title a",
        );
        const href =
          titleLink?.getAttribute("href") ||
          root.querySelector<HTMLAnchorElement>("a.uad-image")?.getAttribute("href") ||
          null;
        if (!href) continue;

        const key = uadid || href;
        if (seen.has(key)) continue;
        seen.add(key);

        const name = (titleLink?.textContent || "").replace(/\s+/g, " ").trim();

        const priceEl =
          root.querySelector<HTMLElement>(".uad-col-price .uad-price .text-nowrap") ||
          root.querySelector<HTMLElement>(".uad-price .text-nowrap") ||
          root.querySelector<HTMLElement>(".uad-price");
        const priceText = (priceEl?.textContent || "").replace(/\s+/g, " ").trim() || null;

        const imgEl = root.querySelector<HTMLImageElement>(
          ".uad-col-image a.uad-image img, .uad-col-image img, img",
        );
        const image =
          imgEl?.getAttribute("data-retina-url") ||
          imgEl?.getAttribute("src") ||
          imgEl?.getAttribute("data-src") ||
          null;

        const seller =
          (root.querySelector<HTMLElement>(".uad-user-text a")?.textContent || "").trim() || null;
        const location =
          (root.querySelector<HTMLElement>(".uad-cities")?.textContent || "")
            .replace(/\s+/g, " ")
            .trim() || null;
        const timeText =
          (
            root.querySelector<HTMLElement>(".uad-col-info .uad-time time, .uad-time time")
              ?.textContent || ""
          )
            .replace(/\s+/g, " ")
            .trim() || null;

        const iced =
          root.classList.contains("uad-status-iced") ||
          Boolean(root.querySelector(".uad-price-iced"));
        const company =
          root.classList.contains("uad-business-user") ||
          Boolean(root.querySelector(".uad-corner-ribbon-bazaar"));
        const featured =
          root.classList.contains("featured") ||
          Boolean(root.querySelector(".uad-corner-ribbon-feat"));

        out.push({
          uadid: uadid || null,
          href,
          name,
          priceText,
          image,
          seller,
          location,
          timeText,
          iced,
          company,
          featured,
        });
      } catch {
        /* skip malformed row */
      }
    }

    return out;
  });
}

/**
 * hardverapro only serves its search endpoint (`…/keres.php`) to a session it
 * has "warmed up": the very first requests from a fresh session are answered
 * with a `302` to the unfiltered browse page (`/aprok/index.html`) — the query
 * string is silently dropped, so you get the newest ads instead of matches.
 * After a couple of requests the session is trusted and `keres.php` returns the
 * real, filtered result page.
 *
 * We therefore navigate to a search URL and, when the browser ends up
 * somewhere other than `keres.php`, retry with a short delay until the address
 * bar stays on `keres.php` (or we give up and report a failed page so we never
 * parse the unfiltered fallback by mistake).
 */
const SEARCH_WARMUP_ATTEMPTS = 6;

async function gotoHardverapro(page: Page, url: string): Promise<boolean> {
  const isSearch = /keres\.php/i.test(url);
  for (let attempt = 1; attempt <= SEARCH_WARMUP_ATTEMPTS; attempt++) {
    await gotoSmart(page, url);
    await dismissConsent(page);
    try {
      await page.waitForSelector("li.media[data-uadid], .uad-list", { timeout: 12_000 });
    } catch {
      /* empty page / challenge page — handled by the caller */
    }
    if (!isSearch || page.url().includes("keres.php")) return true;
    log(
      "hardverapro",
      `search redirected to browse page (attempt ${attempt}/${SEARCH_WARMUP_ATTEMPTS}) — warming up`,
    );
    await humanDelay(1800, 3200);
  }
  return false;
}

/** Resolve the next results page from the pager (`a[rel="next"]`). */
async function nextPageUrl(page: Page, currentUrl: string): Promise<string | null> {
  const href = await page.evaluate(() => {
    const a =
      document.querySelector<HTMLAnchorElement>("li.nav-arrow a[rel='next'][href]") ||
      document.querySelector<HTMLAnchorElement>("a[rel='next'][href]");
    return a?.getAttribute("href") || null;
  });
  if (!href) return null;
  const next = absoluteUrl(currentUrl, href);
  if (!next || next === currentUrl) return null;
  return next;
}

async function scrapeHardveraproItem(page: Page, url: string): Promise<EngineItemScrapeResult> {
  await gotoSmart(page, url);
  await dismissConsent(page);
  try {
    await page.waitForSelector(".uad h1, .uad-details, .rtif-content, main", { timeout: 12_000 });
  } catch {
    /* continue — still try to parse */
  }

  const raw = await page.evaluate(() => {
    const text = (el: Element | null | undefined) =>
      el?.textContent?.replace(/\s+/g, " ").trim() || "";

    /** Multi-line text with <br>/paragraph breaks preserved. */
    const blockText = (el: Element | null | undefined): string => {
      if (!el) return "";
      const clone = el.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("script, style, noscript, button, form, svg, .dropdown, .btn-share")
        .forEach((n) => n.remove());
      clone.querySelectorAll("br").forEach((br) => {
        br.replaceWith(document.createTextNode("\n"));
      });
      clone.querySelectorAll("p, div, li, tr, h1, h2, h3, h4").forEach((node) => {
        if (!node.textContent?.endsWith("\n")) node.appendChild(document.createTextNode("\n"));
      });
      return (clone.innerText || clone.textContent || "")
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const name =
      text(document.querySelector(".uad h1")) ||
      text(document.querySelector("h1")) ||
      document.title.split("|")[0]?.trim() ||
      "";

    const priceText =
      text(document.querySelector(".uad-details h2")) ||
      text(document.querySelector("h2.text-center")) ||
      null;

    // Location + delivery note from the info block (map-marker / carry-box icons)
    const infoSpans = Array.from(
      document.querySelectorAll<HTMLElement>(".uad-time-location > span, .uad-content-block span"),
    );
    const locationSpan = infoSpans.find((s) => s.querySelector(".fa-map-marker"));
    const deliverySpan = infoSpans.find((s) => s.querySelector(".fa-person-carry-box"));
    const location = locationSpan ? text(locationSpan) : "";
    const delivery = deliverySpan ? text(deliverySpan) : "";

    const seller =
      text(document.querySelector(".uad-actions a[href*='/tag/']")) ||
      text(document.querySelector("table td b a[href*='/tag/']")) ||
      text(document.querySelector("a[href*='/tag/'][href*='mode=ratings']")) ||
      "";

    const postedAt = text(document.querySelector("[title='Feladás időpontja']"));
    const lastUp = text(document.querySelector("[title='Utolsó UP dátuma']"));

    // Attributes: the details table (Állapot / Szándék …)
    const attributes: Record<string, string> = {};
    for (const row of Array.from(document.querySelectorAll(".uad-details table tr"))) {
      const th = text(row.querySelector("th"));
      const td = text(row.querySelector("td"));
      if (th && td && th.length < 60 && td.length < 120) attributes[th.replace(/:\s*$/, "")] = td;
    }
    if (location) attributes["Helyszín"] = location;
    if (delivery) attributes["Átvétel"] = delivery;
    if (seller) attributes["Hirdető"] = seller;
    if (postedAt) attributes["Feladva"] = postedAt;
    if (lastUp) attributes["Utolsó UP"] = lastUp;

    // Description lives in the ad body (`.rtif-content.uad-content`), which also
    // wraps share buttons — prefer the inner body that holds paragraphs.
    let description = "";
    const bodyInner = document.querySelector(".rtif-content.uad-content .rtif-content");
    if (bodyInner) description = blockText(bodyInner);
    if (!description) {
      description = blockText(document.querySelector(".rtif-content.uad-content, .rtif-content"));
    }
    if (!description) {
      const paras = Array.from(document.querySelectorAll(".uad-content p"))
        .map((p) => text(p))
        .filter((t) => t.length > 0);
      description = paras.join("\n\n");
    }

    // Images: full-size slides plus indicator thumbnails (deduped by path).
    const images: string[] = [];
    const seen = new Set<string>();
    const pushImg = (src: string | null | undefined) => {
      if (!src || images.length >= 16) return;
      if (src.startsWith("data:")) return;
      if (/logo|icon|sprite|pixel|faces\//i.test(src)) return;
      const key = src.split("/").pop() || src;
      if (seen.has(key)) return;
      seen.add(key);
      images.push(src);
    };
    for (const img of Array.from(
      document.querySelectorAll<HTMLImageElement>(
        "#uad-images-carousel .carousel-inner img, #uad-images-carousel .carousel-indicators img, .uad-content img",
      ),
    )) {
      pushImg(img.getAttribute("data-src") || img.getAttribute("src") || img.currentSrc);
    }
    if (images.length === 0) {
      pushImg(document.querySelector<HTMLMetaElement>("meta[property='og:image']")?.content);
    }

    return {
      name,
      priceText,
      description,
      attributes,
      images,
      location,
      seller,
    };
  });

  const price = parsePriceHu(raw.priceText != null ? String(raw.priceText) : null);
  const images = (Array.isArray(raw.images) ? (raw.images as string[]) : [])
    .map((src) => fullSizeImage(src))
    .filter((src): src is string => Boolean(src));
  const details: ListingItemDetails = {
    description: raw.description ? String(raw.description).slice(0, 8000) : null,
    images,
    attributes: (raw.attributes as Record<string, string>) || {},
    extra: { source: "hardverapro.item", priceText: raw.priceText },
  };

  if (!raw.name && !details.description && details.images!.length === 0) {
    return { details: null, error: "Could not parse hardverapro item page" };
  }

  return {
    details,
    name: raw.name ? String(raw.name) : null,
    price,
    image: details.images?.[0] ?? null,
  };
}

export const hardveraproEngine: EngineScraper = {
  slug: ENGINE_SLUGS.hardverapro,
  name: "hardverapro.hu",

  async scrapeItem(page, input) {
    log("hardverapro", `item: ${input.url}`);
    return scrapeHardveraproItem(page, input.url);
  },

  async scrape(page, routine) {
    const depth = Math.min(Math.max(Number(routine.depth) || 2, 1), 20);
    const minPrice =
      routine.minPrice != null && routine.minPrice !== "" ? Number(routine.minPrice) : null;
    const maxPrice =
      routine.maxPrice != null && routine.maxPrice !== "" ? Number(routine.maxPrice) : null;
    const noIced = Boolean(routine.noIced);

    const items: ScrapedItem[] = [];
    let pagesFetched = 0;
    let pagesFailed = 0;
    const seenIds = new Set<string>();

    let url: string | null = buildHardveraproSearchUrl(routine, 0);
    log("hardverapro", `start: ${url}`);

    for (let pageNum = 1; pageNum <= depth && url; pageNum++) {
      log("hardverapro", `page ${pageNum}: ${url}`);
      try {
        const loaded = await gotoHardverapro(page, url);
        if (!loaded) {
          pagesFailed++;
          log("hardverapro", `page ${pageNum}: search page unavailable — aborting`);
          break;
        }

        const raw = await extractListings(page);
        pagesFetched++;
        log("hardverapro", `page ${pageNum}: ${raw.length} ad row(s)`);

        if (raw.length === 0) {
          log("hardverapro", pageNum === 1 ? "no ads on first page — done" : "empty page — stopping");
          break;
        }

        let newOnPage = 0;
        for (const r of raw) {
          const price = parsePriceHu(r.priceText != null ? String(r.priceText) : null);

          if (minPrice != null && price != null && price < minPrice) continue;
          if (maxPrice != null && price != null && price > maxPrice) continue;
          if (noIced && r.iced) continue;

          const itemUrl = absoluteUrl(BASE, String(r.href ?? ""));
          if (!itemUrl) continue;
          const idSeed = r.uadid ? String(r.uadid) : itemUrl;
          const id = String(cyrb53(`${idSeed}-${ENGINE_SLUGS.hardverapro}`));
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          newOnPage++;

          items.push({
            id,
            name: String(r.name || "Untitled"),
            price,
            url: itemUrl,
            image: fullSizeImage(r.image != null ? String(r.image) : null),
            seller: r.seller ? String(r.seller) : null,
            location: r.location ? String(r.location) : null,
            company: Boolean(r.company),
            featured: Boolean(r.featured),
            iced: Boolean(r.iced),
          });
        }
        log("hardverapro", `page ${pageNum}: ${newOnPage} new ad(s)`);

        if (pageNum >= depth) break;

        const next = await nextPageUrl(page, url);
        if (!next) {
          log("hardverapro", `no next page after ${pageNum} — done`);
          break;
        }
        url = next;
        await humanDelay(1200, 2600);
      } catch (err) {
        pagesFailed++;
        log("hardverapro", `page ${pageNum} failed: ${err}`);
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
