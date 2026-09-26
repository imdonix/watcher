import type { Page } from "playwright";
import {
  buildJofogasSearchUrl,
  cyrb53,
  ENGINE_SLUGS,
  type ListingItemDetails,
  type ScrapedItem,
} from "@watcher/shared";
import { absoluteUrl, humanDelay, parsePriceHu } from "../lib/util";
import { dismissConsent } from "../lib/consent";
import { gotoSmart } from "../browser";
import type { EngineItemScrapeResult, EngineScraper } from "./types";
import { log } from "../lib/log";

/**
 * Extract ads from both:
 * - modern MUI cards on www.jofogas.hu
 * - real-estate list items on ingatlan.jofogas.hu (.list-item / .price-value)
 *
 * NOTE: everything inside page.evaluate() is serialized into the browser —
 * helpers used there must be declared inside the evaluate callback.
 */
async function extractItems(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const results: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();

    /** True when the text is a bare money amount (with or without a currency suffix). */
    const isAmountLike = (t: string): boolean =>
      /^[\d][\d\s.,]*$/.test(t) || /^[\d][\d\s.,]*\s*(Ft|HUF|€|EUR)$/i.test(t);

    /**
     * Extract the price from a modern MUI ad card.
     *
     * Jófogás moved the price out of the headings: the card title now lives in
     * <h2> while the amount is a separate <p class="MuiTypography-h3">75 000</p>
     * followed by <p>Ft</p>. Reading the heading as a price yields the title's
     * digits (e.g. "iphone 13 …" → 13128), which then gets dropped by the
     * routine's min/max price filter — so always validate the candidate.
     */
    const pickCardPrice = (root: HTMLElement): string | null => {
      for (const sel of [
        "[data-testid='ad-price']",
        "p.MuiTypography-h3",
        "p.MuiTypography-h4",
        ".price-value",
        "[itemprop='price']",
        "h2.MuiTypography-h2",
      ]) {
        for (const node of Array.from(root.querySelectorAll(sel))) {
          const t = (node.textContent || "").replace(/\s+/g, " ").trim();
          if (!isAmountLike(t)) continue;
          if (/(Ft|HUF|€|EUR)/i.test(t)) return t;
          // bare amount → only trust it when a currency marker sits nearby
          const near = `${node.parentElement?.textContent || ""} ${node.nextElementSibling?.textContent || ""}`;
          if (/(Ft|HUF|€|EUR)/i.test(near)) return `${t} Ft`;
        }
      }

      // Generic: leaf holding only digits with a currency sibling/parent
      for (const node of Array.from(root.querySelectorAll("*"))) {
        if (node.children.length) continue;
        const t = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (!/^[\d][\d\s.,]*$/.test(t)) continue;
        const near = `${node.parentElement?.textContent || ""} ${node.nextElementSibling?.textContent || ""}`;
        if (/(Ft|HUF|€|EUR)/i.test(near)) return `${t} Ft`;
      }

      // Text layout: amount line directly followed by a "Ft" line
      const lines = (root.innerText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^[\d][\d\s.,]*$/.test(lines[i]) && /^(Ft|HUF|€|EUR)$/i.test(lines[i + 1])) {
          return `${lines[i]} Ft`;
        }
      }
      return null;
    };

    function push(item: {
      rawId: string;
      name: string;
      priceText: string | null;
      image: string | null;
      url: string;
      company: boolean;
      post: boolean;
    }) {
      if (!item.url || seen.has(item.url)) return;
      seen.add(item.url);
      results.push(item);
    }

    // ── Modern MUI layout (general goods) ──────────────────────────
    for (const el of Array.from(
      document.querySelectorAll('[data-testid="ad-card-general"]'),
    )) {
      try {
        const root = el as HTMLElement;
        const linkEl = root.querySelector(
          "a[href*='.htm'], a.MuiLink-root",
        ) as HTMLAnchorElement | null;
        const url = linkEl?.href || null;
        if (!url) continue;
        if (!/\.htm/i.test(url) && !/hirdetes/i.test(url)) continue;

        // Title: current layout uses <h2> (MuiTypography-h4); older used h5.
        // Skip amount-like headings (older layouts kept the price in <h2>).
        let name = "";
        for (const sel of [
          "[data-testid='ad-title']",
          "h2.MuiTypography-h4",
          "h5.MuiTypography-h5, h5",
          "h2",
        ]) {
          for (const node of Array.from(root.querySelectorAll(sel))) {
            const t = (node.textContent || "").replace(/\s+/g, " ").trim();
            if (!t || isAmountLike(t)) continue;
            name = t;
            break;
          }
          if (name) break;
        }
        if (!name) {
          name =
            (root.innerText || "")
              .split("\n")
              .map((s) => s.trim())
              .find((s) => s.length > 8 && !/^\d/.test(s)) || "";
        }

        const priceText = pickCardPrice(root);

        const imgEl = root.querySelector("img") as HTMLImageElement | null;
        const img = imgEl?.src || imgEl?.getAttribute("data-src") || null;

        const fullText = root.innerText || "";
        const company =
          /üzleti felhasználó|bolt\s*\(/i.test(fullText) ||
          Boolean(root.querySelector(".badge-company_ad, [data-testid='company-badge']"));
        const post = Boolean(root.querySelector(".badge-box, [data-testid='post-badge']"));
        const idMatch = url.match(/_(\d+)\.htm/i);

        push({
          rawId: idMatch?.[1] || url,
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

    // ── Real-estate / legacy list-item layout (ingatlan.jofogas.hu) ─
    for (const el of Array.from(
      document.querySelectorAll(
        ".list-item, .reListElement, .realestate-item, .reListItem, [data-testid='list-item']",
      ),
    )) {
      try {
        const root = el as HTMLElement;
        // Prefer the product node inside list-item
        const product =
          (root.querySelector(
            ".realestate-item, .reListItem, [itemtype*='Product'], .jfg-item",
          ) as HTMLElement | null) || root;

        // Detail URL: prefer real .htm ad link (not list hash meta url)
        const linkEl = product.querySelector(
          "a[href*='.htm'], a.subject, a.item-link",
        ) as HTMLAnchorElement | null;
        let url = linkEl?.href || null;

        const metaUrl = product
          .querySelector("meta[itemprop='url']")
          ?.getAttribute("content");
        // meta url is often the list page + #id — only use if no .htm link
        if (!url && metaUrl && /\.htm/i.test(metaUrl)) url = metaUrl;
        if (!url && metaUrl && /#\d+/.test(metaUrl)) {
          // synthesize from list id if present
          const id = metaUrl.match(/#(\d+)/)?.[1];
          if (id) {
            const anyHtm = product.querySelector(
              `a[href*='_${id}.htm'], a[href*='${id}.htm']`,
            ) as HTMLAnchorElement | null;
            url = anyHtm?.href || null;
          }
        }
        if (!url) continue;
        if (!/\.htm/i.test(url) && !/hirdetes/i.test(url) && !/#\d+/.test(url)) continue;

        // Name: schema meta, then item-title
        const name =
          product.querySelector("meta[itemprop='name']")?.getAttribute("content")?.trim() ||
          product.querySelector(".item-title, [itemprop='name'], a.subject")?.textContent?.trim() ||
          linkEl?.textContent?.trim() ||
          "";

        // Price: itemprop content is most reliable ("180000")
        const priceEl = product.querySelector(
          ".price-value, [itemprop='price'], .item-price .price-value, .priceBox .price-value",
        );
        let priceText: string | null =
          priceEl?.getAttribute("content") ||
          priceEl?.textContent?.replace(/\s+/g, " ").trim() ||
          null;

        // Fallback: full price box "180 000 Ft" (avoid Ft/m² square price)
        if (!priceText) {
          const box = product.querySelector(".priceBox, .item-price, .price");
          const boxText = box?.textContent?.replace(/\s+/g, " ").trim() || "";
          // Prefer line without /m²
          const m = boxText.match(/(\d[\d\s.]*)\s*Ft(?!\s*\/\s*m)/i);
          if (m) priceText = m[0];
        }

        // Avoid square metre prices accidentally used as main price
        if (priceText && /\/\s*m/i.test(priceText)) {
          priceText =
            product
              .querySelector(".price-value[itemprop='price'], [itemprop='price']")
              ?.getAttribute("content") || null;
        }

        const imgMeta = product
          .querySelector("meta[itemprop='image']")
          ?.getAttribute("content");
        const imgEl = product.querySelector("img") as HTMLImageElement | null;
        const image =
          imgMeta ||
          imgEl?.src ||
          imgEl?.getAttribute("data-src") ||
          imgEl?.getAttribute("data-original") ||
          null;

        const fullText = product.innerText || "";
        const company =
          /üzleti felhasználó|bolt\s*\(/i.test(fullText) ||
          Boolean(
            product.querySelector(
              ".badge-company_ad, .company-item, [data-testid='company-badge']",
            ),
          );
        const post = Boolean(product.querySelector(".badge-box, [data-testid='post-badge']"));

        const idMatch = url.match(/_(\d+)\.htm/i) || url.match(/#(\d+)/);
        const listId =
          product.id?.replace(/^listid_/, "") ||
          product.getAttribute("id")?.replace(/^listid_/, "") ||
          null;

        push({
          rawId: idMatch?.[1] || listId || url,
          name,
          priceText,
          image,
          url,
          company,
          post,
        });
      } catch {
        /* skip */
      }
    }

    return results;
  });
}

/**
 * Resolve next list URL.
 * Real-estate (ingatlan.jofogas.hu) uses `?o=2` page index via
 * `a.ad-list-pager-item-next` / `a.ad-list-pager-page-number`.
 * Modern MUI site uses different pagination.
 */
async function nextPageUrl(page: Page, currentUrl: string): Promise<string | null> {
  const found = await page.evaluate(() => {
    // Explicit next arrow (only when it's an <a>, not a disabled <span>)
    const nextArrow = document.querySelector(
      "a.ad-list-pager-item-next[href], a.ad-list-pager-item-next.active-item[href]",
    ) as HTMLAnchorElement | null;
    if (nextArrow?.href && !nextArrow.classList.contains("disabled")) {
      return { href: nextArrow.href, via: "next-arrow" };
    }

    // Active page number → next sibling page number link
    const activeNum =
      document.querySelector(
        "a.ad-list-pager-page-number.active, .ad-list-pager-page-number.active-item, li.active a.ad-list-pager-page-number, .pagination .active a",
      ) ||
      // current page is often a <span> or <a> without being "next"
      Array.from(document.querySelectorAll("a.ad-list-pager-page-number")).find((a) =>
        a.classList.contains("active-item") || a.classList.contains("active"),
      );

    // All numbered page links sorted by o=
    const numLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a.ad-list-pager-page-number[href]"),
    );
    if (numLinks.length > 0) {
      const currentO = (() => {
        try {
          return Number(new URL(location.href).searchParams.get("o") || "1");
        } catch {
          return 1;
        }
      })();
      for (const a of numLinks) {
        try {
          const o = Number(new URL(a.href).searchParams.get("o") || "0");
          if (o === currentO + 1) return { href: a.href, via: `page-num-o=${o}` };
        } catch {
          /* skip */
        }
      }
      // fallback: first page number strictly greater than current
      const richer = numLinks
        .map((a) => {
          try {
            return { href: a.href, o: Number(new URL(a.href).searchParams.get("o") || 0) };
          } catch {
            return null;
          }
        })
        .filter((x): x is { href: string; o: number } => !!x && x.o > currentO)
        .sort((a, b) => a.o - b.o);
      if (richer[0]) return { href: richer[0].href, via: `page-num-next-o=${richer[0].o}` };
    }

    // MUI / general jofogas
    const relNext = document.querySelector("a[rel='next']") as HTMLAnchorElement | null;
    if (relNext?.href) return { href: relNext.href, via: "rel-next" };

    // MUI pagination renders <button> items (no href) and navigates to ?o=N
    const muiPager = document.querySelector(
      '[data-testid="pagination"], .MuiPagination-root',
    );
    if (muiPager) {
      const prevNext = Array.from(
        muiPager.querySelectorAll<HTMLButtonElement>("button.MuiPaginationItem-previousNext"),
      );
      const nextBtn = prevNext[prevNext.length - 1];
      const selected = muiPager.querySelector(
        ".MuiPaginationItem-page.Mui-selected",
      ) as HTMLElement | null;
      const current = Number((selected?.textContent || "").trim()) || 1;
      if (nextBtn && !nextBtn.disabled) {
        try {
          const u = new URL(location.href);
          u.searchParams.set("o", String(current + 1));
          return { href: u.toString(), via: `mui-button-o=${current + 1}` };
        } catch {
          /* fall through */
        }
      }
      // Pager present but next disabled → last page
      return { href: null, via: "mui-no-next" };
    }

    const muiActive = document.querySelector(
      ".MuiPaginationItem-page.Mui-selected, .Mui-selected[aria-current='true']",
    );
    const muiNext = muiActive?.parentElement?.nextElementSibling?.querySelector("a, button");
    if (muiNext instanceof HTMLAnchorElement && muiNext.href) {
      return { href: muiNext.href, via: "mui-next" };
    }

    // Pager present but next disabled / missing → last page
    const pager = document.querySelector(".ad-list-pager, .pagination-block, ul.pagination");
    if (pager) {
      return { href: null, via: "pager-no-next" };
    }

    return { href: null, via: "no-pager" };
  });

  if (found.href) {
    // Normalize and avoid looping on same URL
    try {
      const next = new URL(found.href, currentUrl).toString();
      const cur = new URL(currentUrl);
      const nxt = new URL(next);
      // Compare path+query ignoring param order for o
      if (nxt.pathname === cur.pathname) {
        const co = cur.searchParams.get("o") || "1";
        const no = nxt.searchParams.get("o") || "1";
        if (co === no && nxt.search === cur.search) return null;
      }
      if (next === currentUrl) return null;
      return next;
    } catch {
      return found.href === currentUrl ? null : found.href;
    }
  }

  // No DOM next — try bumping o= if we're on a multi-page-capable RE list and
  // this page looked full. Caller decides based on item count.
  return null;
}

/** Build `?o=N` next URL for jofogas real-estate when DOM next is missing but page was full. */
function bumpJofogasPage(currentUrl: string): string | null {
  try {
    const u = new URL(currentUrl);
    const cur = Number(u.searchParams.get("o") || "1");
    if (!Number.isFinite(cur) || cur < 1) return null;
    u.searchParams.set("o", String(cur + 1));
    return u.toString();
  } catch {
    return null;
  }
}

/** Parse jofogas price text/content, including bare "180000" and "180 000 Ft". */
function parseJofogasPrice(text: string | null | undefined): number | null {
  if (text == null || text === "") return null;
  const t = String(text).replace(/\u00a0/g, " ").trim();

  // Schema content is often pure digits
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Reject letter-heavy text (e.g. a title accidentally fed in as price):
  // only currency codes may remain after stripping digits/separators.
  const letters = t.replace(/[\d\s.,/]+/g, "").replace(/\b(Ft|HUF|EUR|€)\b/gi, "");
  if (/[^\W\d_]/i.test(letters)) return null;

  // Never treat m² rates as listing price
  if (/Ft\s*\/\s*m/i.test(t) && !/Ft(?!\s*\/\s*m)/i.test(t.replace(/Ft\s*\/\s*m[²2]?/gi, ""))) {
    return null;
  }

  // Strip square-metre suffix noise then parse
  const cleaned = t.replace(/[\d\s.]+\s*Ft\s*\/\s*m[²2]?/gi, " ").trim();
  return parsePriceHu(cleaned || t);
}

/** Jófogás chrome / legal copy that must never be treated as the ad description. */
const JOFOGAS_BOILERPLATE_RE =
  /elérhető kapcsolattartási lehetőségeket a hirdető határozza meg|keress és válogass közel másfélmillió|felhasználói szabályzatunk|adatvédelmi tájékoztatónk|a jófogást megtalálod a közösségi|szerzői jogi védelem alatt álló oldal|a honlapon elhelyezett szöveges és képi|cookie|sütik|felhasználói szabályzat|adatvédelmi szabályzat|minden jog fenntartva|copyright|©\s*j[oó]fog[aá]s/i;

function isJofogasBoilerplate(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (JOFOGAS_BOILERPLATE_RE.test(t)) return true;
  // Long multi-sentence legal/marketing blobs with no ad-like content
  if (
    t.length > 120 &&
    /szabályzat|adatvédelm|szerzői jog|közösségi oldal/i.test(t) &&
    !/[€$]|\d[\d\s.]*\s*Ft|eladó|kiadó|állapot|méret|km|évjárat/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Drop boilerplate paragraphs; keep real newlines between kept blocks. */
function cleanJofogasDescription(raw: string): string {
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    // collapse spaces/tabs within a line, keep newlines
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return "";

  const blocks = normalized
    .split(/\n{2,}|\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const kept: string[] = [];
  for (const block of blocks) {
    if (isJofogasBoilerplate(block)) continue;
    // Skip ultra-short nav crumbs
    if (block.length < 3) continue;
    kept.push(block);
  }

  // Re-join with blank lines so UI whitespace-pre-wrap shows paragraphs
  return kept.join("\n\n").slice(0, 8000);
}

async function scrapeJofogasItem(page: Page, url: string): Promise<EngineItemScrapeResult> {
  await gotoSmart(page, url);
  await dismissConsent(page);
  try {
    await page.waitForSelector("h1, [data-testid='ad-title'], .advert-title, article", {
      timeout: 12_000,
    });
  } catch {
    /* continue — still try to parse */
  }

  const raw = await page.evaluate(() => {
    /** Single-line collapse (titles, prices, attributes). */
    const text = (el: Element | null | undefined) =>
      el?.textContent?.replace(/\s+/g, " ").trim() || "";

    // ── JSON-LD: flatten @graph / mainEntity / offers into one node list ──
    const jsonLdNodes: Array<Record<string, unknown>> = [];
    for (const script of Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )) {
      try {
        const data = JSON.parse(script.textContent || "null") as unknown;
        const stack: unknown[] = Array.isArray(data) ? [...data] : [data];
        while (stack.length) {
          const n = stack.shift();
          if (!n || typeof n !== "object") continue;
          const o = n as Record<string, unknown>;
          jsonLdNodes.push(o);
          for (const key of ["@graph", "mainEntity", "offers", "itemListElement"]) {
            const v = o[key];
            if (Array.isArray(v)) stack.push(...v);
            else if (v && typeof v === "object") stack.push(v);
          }
        }
      } catch {
        /* ignore malformed JSON-LD */
      }
    }

    /**
     * Preserve line breaks from the ad body.
     * Prefer innerText (layout-aware). Convert <br> and block tags to newlines
     * when walking a dedicated description node.
     */
    const blockText = (el: Element | null | undefined): string => {
      if (!el) return "";
      const clone = el.cloneNode(true) as HTMLElement;
      // Drop nested chrome inside the description container
      clone
        .querySelectorAll("script, style, noscript, button, nav, footer, form, svg")
        .forEach((n) => n.remove());
      clone.querySelectorAll("br").forEach((br) => {
        br.replaceWith(document.createTextNode("\n"));
      });
      // Block elements → trailing newline
      clone.querySelectorAll("p, div, li, h1, h2, h3, h4, tr, section, article").forEach((node) => {
        if (!node.textContent?.endsWith("\n")) {
          node.appendChild(document.createTextNode("\n"));
        }
      });
      const rawText = clone.innerText || clone.textContent || "";
      return rawText
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const inFooterOrNav = (el: Element | null) => {
      if (!el) return true;
      return Boolean(el.closest("footer, nav, header, [role='navigation'], [role='contentinfo']"));
    };

    const name =
      text(document.querySelector("h1")) ||
      text(document.querySelector("[data-testid='ad-title']")) ||
      text(document.querySelector(".advert-title, .product-title")) ||
      document.title.split("|")[0]?.trim() ||
      "";

    const priceText =
      text(
        document.querySelector(
          "[data-testid='ad-price'], [data-testid='ad-view-info-price'], .price-value",
        ),
      ) ||
      text(document.querySelector("h2.MuiTypography-h2")) ||
      text(document.querySelector(".priceBox .price-value, [itemprop='price']")) ||
      (() => {
        for (const node of jsonLdNodes) {
          const offers = node.offers;
          const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
          for (const o of list) {
            if (!o || typeof o !== "object") continue;
            const p = (o as Record<string, unknown>).price;
            if (typeof p === "string" || typeof p === "number") return String(p);
          }
          if (typeof node.price === "string" || typeof node.price === "number") {
            return String(node.price);
          }
        }
        return "";
      })() ||
      null;

    // ── Description: prefer dedicated ad body, never whole-page fallback ──
    const DESC_SELECTORS = [
      "[data-testid='ad-description']",
      "[data-testid='ad-body']",
      "[data-testid='real-estate-product-description-collapse']",
      "#ad-description",
      ".advert-description",
      ".item-description",
      ".product-description",
      ".re-description",
      "[itemprop='description']",
      // Common jofogas/legacy class names
      ".advert-details-description",
      ".ad-description",
      "#description",
      "[class*='AdDescription']",
      "[class*='adDescription']",
      "[class*='DescriptionText']",
    ];

    let description = "";
    for (const sel of DESC_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el || inFooterOrNav(el)) continue;
      const t = blockText(el);
      if (t.length >= 8) {
        description = t;
        break;
      }
    }

    // JSON-LD Product/Offer description (often clean, but may be single line
    // and may contain literal <br> HTML)
    if (!description) {
      for (const node of jsonLdNodes) {
        const d = node.description;
        if (typeof d === "string" && d.trim().length >= 8) {
          description = d
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>\s*<p>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .trim();
          break;
        }
      }
    }

    // Heading "Leírás" / "Leiras" followed by sibling content (MUI / RE layouts)
    if (!description) {
      const headings = Array.from(
        document.querySelectorAll("h2, h3, h4, [class*='MuiTypography']"),
      );
      for (const h of headings) {
        const label = text(h);
        if (!/^le[ií]r[aá]s$/i.test(label) && !/description/i.test(label)) continue;
        if (inFooterOrNav(h)) continue;
        const parent = h.parentElement;
        // Next sibling block, or rest of parent excluding the heading
        let body: Element | null = h.nextElementSibling;
        while (body && (text(body).length < 8 || body === h)) {
          body = body.nextElementSibling;
        }
        if (body && !inFooterOrNav(body)) {
          const t = blockText(body);
          if (t.length >= 8) {
            description = t;
            break;
          }
        }
        if (parent && !inFooterOrNav(parent)) {
          const clone = parent.cloneNode(true) as HTMLElement;
          const first = clone.querySelector("h2, h3, h4");
          first?.remove();
          const t = blockText(clone);
          if (t.length >= 8) {
            description = t;
            break;
          }
        }
        // MUI layout: the "Leírás" heading is isolated in its own div and the
        // body text lives in a sibling div of the heading's container.
        let host: Element | null = parent;
        for (let i = 0; i < 3 && host; i++) {
          host = host.parentElement;
          if (!host || inFooterOrNav(host)) break;
          let sib: Element | null = host.firstElementChild;
          while (sib) {
            if (sib !== h && !inFooterOrNav(sib) && !/le[ií]r[aá]s|description/i.test(text(sib))) {
              const t = blockText(sib);
              if (t.length >= 8) {
                description = t;
                break;
              }
            }
            sib = sib.nextElementSibling;
          }
          if (description) break;
        }
        if (description) break;
      }
    }

    // Last resort: largest non-footer text block in main, excluding known chrome
    if (!description) {
      const candidates = Array.from(
        document.querySelectorAll(
          "main [class*='description'], main [class*='Description'], article [class*='description'], .content [class*='description']",
        ),
      ).filter((el) => !inFooterOrNav(el));
      let best = "";
      for (const el of candidates) {
        const t = blockText(el);
        if (t.length > best.length && t.length >= 20) best = t;
      }
      description = best;
    }

    const attributes: Record<string, string> = {};
    // MUI layout: <div data-testid="param_..."> <span>Márka:</span> <div><span><span>Apple</span>
    // The value span nests its own <span>, so raw collection yields "Apple Apple" —
    // take the label as the first span and the de-duplicated remainder as value.
    for (const row of Array.from(
      document.querySelectorAll("[data-testid^='param_'], [data-testid*='param']"),
    )) {
      if (inFooterOrNav(row)) continue;
      const spans = Array.from(row.querySelectorAll("span")).map((s) => text(s)).filter(Boolean);
      if (spans.length >= 2) {
        const k = spans[0].replace(/[:：]\s*$/, "");
        const rest = spans.slice(1);
        const v = rest.filter((x, i) => rest.indexOf(x) === i).join(" ");
        if (k && v && k.length < 80 && v.length < 200) attributes[k] = v;
      }
    }
    for (const row of Array.from(
      document.querySelectorAll(
        "table tr, .parameter-row, [data-testid*='param'] li, dl > div, .reParam, .param-group",
      ),
    )) {
      if (inFooterOrNav(row)) continue;
      const cells = row.querySelectorAll("td, th, dt, dd, span, strong");
      if (cells.length >= 2) {
        const k = text(cells[0]);
        const v = text(cells[1]);
        if (k && v && k.length < 80 && v.length < 200) attributes[k] = v;
      }
    }
    // dt/dd pairs
    const dts = Array.from(document.querySelectorAll("dt"));
    for (const dt of dts) {
      if (inFooterOrNav(dt)) continue;
      const k = text(dt);
      const v = text(dt.nextElementSibling);
      if (k && v) attributes[k] = v;
    }
    // JSON-LD additionalProperty fallback
    for (const node of jsonLdNodes) {
      const props = node.additionalProperty;
      const list = Array.isArray(props) ? props : props ? [props] : [];
      for (const p of list) {
        if (!p || typeof p !== "object") continue;
        const o = p as Record<string, unknown>;
        const k = typeof o.name === "string" ? o.name : "";
        const v =
          typeof o.value === "string"
            ? o.value
            : typeof o.value === "number"
              ? String(o.value)
              : "";
        if (k && v && !attributes[k]) attributes[k] = v;
      }
    }

    const location = (() => {
      // MUI info card: the smallest node starting with "Cím:" holds
      // "Csongrád-Csanád; Szeged" (larger ancestors mix in categories).
      let best = "";
      for (const el of Array.from(document.querySelectorAll("main *"))) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!/^C[íi]m\s*:/i.test(t) || t.length > 150) continue;
        const v = t
          .replace(/^C[íi]m\s*:\s*/i, "")
          .replace(/Kateg[óo]ria.*$/i, "")
          .trim();
        if (!v) continue;
        if (!best || t.length < best.length) best = t;
      }
      if (best) {
        const v = best
          .replace(/^C[íi]m\s*:\s*/i, "")
          .replace(/Kateg[óo]ria.*$/i, "")
          .replace(/;\s*/g, ", ")
          .trim();
        if (v) return v;
      }

      const crumbs = document.querySelector("[data-testid='viMapBreadcrumb']");
      const c = (crumbs?.textContent || "").replace(/\s+/g, " ").trim();
      if (c) return c;

      return attributes["Helyszín"] || attributes["Település"] || null;
    })();

    const images: string[] = [];
    const seen = new Set<string>();
    const seenKeys = new Set<string>();
    const pushImg = (src: null | undefined | string) => {
      if (!src || images.length >= 12) return;
      if (src.startsWith("data:")) return;
      // Drop chrome: logos/icons/svgs, app-store & social art, OSM map tiles, ad banners
      if (/\/assets\/|\.(svg|gif)(\?|$)/i.test(src)) return;
      if (/logo|icon|avatar|sprite/i.test(src)) return;
      if (/osm\.jofogas|adverticum|doubleclick|googlesyndication/i.test(src)) return;
      if (seen.has(src)) return;
      // Same photo served from different crops (hdimages vs bigthumbs)
      const key = src.split("/").pop() || src;
      if (seenKeys.has(key)) return;
      seen.add(src);
      seenKeys.add(key);
      images.push(src);
    };

    // JSON-LD Product.image is the authoritative gallery (hdimages)
    for (const node of jsonLdNodes) {
      const img = node.image;
      if (typeof img === "string") pushImg(img);
      else if (Array.isArray(img)) {
        for (const i of img) {
          if (typeof i === "string") pushImg(i);
          else if (i && typeof i === "object") {
            const o = i as Record<string, unknown>;
            pushImg((o.url || o.contentUrl) as string | undefined);
          }
        }
      } else if (img && typeof img === "object") {
        const o = img as Record<string, unknown>;
        pushImg((o.url || o.contentUrl) as string | undefined);
      }
    }

    for (const img of Array.from(
      document.querySelectorAll<HTMLImageElement>(
        "img[src*='jofogas'], .gallery img, [data-testid*='gallery'] img, .carousel img, main img",
      ),
    )) {
      if (inFooterOrNav(img)) continue;
      // Suggested/"similar ads" carousels are not part of this listing
      if (img.closest("[data-testid='suggested-ads-slider'], .similar-ads")) continue;
      const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
      pushImg(src);
    }

    const seller =
      text(
        document.querySelector(
          "[data-testid='contact-box-user-name'], [data-testid='seller-name'], .seller-name, .advertiser-name",
        ),
      ) ||
      null;

    return { name, priceText, description, attributes, location, images, seller };
  });

  const price = parseJofogasPrice(raw.priceText != null ? String(raw.priceText) : null);
  const attributes: Record<string, string | number | boolean | null> = {
    ...(raw.attributes as Record<string, string>),
  };
  if (raw.location) attributes["Location"] = String(raw.location);
  if (raw.seller) attributes["Seller"] = String(raw.seller);

  const description = cleanJofogasDescription(String(raw.description || ""));

  const details: ListingItemDetails = {
    description: description || null,
    images: Array.isArray(raw.images) ? (raw.images as string[]) : [],
    attributes,
    extra: { source: "jofogas.item", priceText: raw.priceText },
  };

  if (!raw.name && !details.description && details.images!.length === 0) {
    return { details: null, error: "Could not parse jofogas item page" };
  }

  return {
    details,
    name: raw.name ? String(raw.name) : null,
    price,
    image: details.images?.[0] ?? null,
  };
}

export const jofogasEngine: EngineScraper = {
  slug: ENGINE_SLUGS.jofogas,
  name: "jofogas.hu",

  async scrapeItem(page, input) {
    log("jofogas", `item: ${input.url}`);
    return scrapeJofogasItem(page, input.url);
  },

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
    const seenIds = new Set<string>();

    for (let pageNum = 0; pageNum < depth && url; pageNum++) {
      log("jofogas", `page ${pageNum + 1}: ${url}`);
      try {
        await gotoSmart(page, url);
        await dismissConsent(page);
        try {
          await page.waitForSelector(
            '[data-testid="ad-card-general"], .list-item, .realestate-item, .MuiCard-root',
            { timeout: 12_000 },
          );
        } catch {
          log("jofogas", "no cards selector timed out (page still counts if HTML loaded)");
        }

        const raw = await extractItems(page);
        pagesFetched++;
        log("jofogas", `raw cards: ${raw.length}`);

        if (raw.length === 0) {
          log(
            "jofogas",
            pageNum === 0
              ? "no cards on first page — done"
              : `empty page ${pageNum + 1} — stopping`,
          );
          break;
        }

        let priced = 0;
        let newOnPage = 0;
        for (const r of raw) {
          const price = parseJofogasPrice(
            r.priceText != null ? String(r.priceText) : null,
          );
          if (price != null) priced++;

          if (minPrice != null && price != null && price < minPrice) continue;
          if (maxPrice != null && price != null && price > maxPrice) continue;
          if (!enableCompany && r.company) continue;
          if (!enablePost && r.post) continue;

          const itemUrl =
            absoluteUrl("https://ingatlan.jofogas.hu", String(r.url ?? "")) ||
            absoluteUrl(domain, String(r.url ?? "")) ||
            String(r.url);
          const idSeed = String(r.rawId ?? itemUrl);
          const id = String(cyrb53(`${idSeed}-${ENGINE_SLUGS.jofogas}`));
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          newOnPage++;
          items.push({
            id,
            name: String(r.name || "Untitled"),
            price,
            url: itemUrl,
            image: r.image ? String(r.image) : null,
            company: Boolean(r.company),
            post: Boolean(r.post),
          });
        }
        log(
          "jofogas",
          `page ${pageNum + 1}: ${priced}/${raw.length} priced, ${newOnPage} new`,
        );

        // RE site uses ?o=2 via a.ad-list-pager-item-next (disabled = <span>, no more pages)
        let next = await nextPageUrl(page, url);
        if (!next && raw.length >= 20 && pageNum + 1 < depth) {
          const bumped = bumpJofogasPage(url);
          if (bumped && bumped !== url) {
            log("jofogas", `no DOM next but ${raw.length} cards — trying ${bumped}`);
            next = bumped;
          }
        }

        if (!next || next === url) {
          log("jofogas", `no further pages after page ${pageNum + 1} — done`);
          break;
        }

        url = next;
        await humanDelay(1000, 2500);
      } catch (err) {
        pagesFailed++;
        log("jofogas", `page failed: ${err}`);
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
