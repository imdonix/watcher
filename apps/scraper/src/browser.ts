import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { log } from "./lib/log";
import { humanDelay, randomBetween } from "./lib/util";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

export class BrowserPool {
  private browser: Browser | null = null;
  private headless: boolean;
  private maxConcurrency: number;
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(opts?: { headless?: boolean; maxConcurrency?: number }) {
    this.headless = opts?.headless ?? process.env.HEADLESS !== "false";
    this.maxConcurrency = opts?.maxConcurrency ?? Number(process.env.SCRAPER_MAX_CONCURRENCY || 2);
  }

  async init(): Promise<void> {
    if (this.browser) return;
    log("Browser", `launching chromium (headless=${this.headless})`);
    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-infobars",
        "--window-size=1920,1080",
        "--lang=hu-HU,hu,en-US,en",
      ],
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  async withPage<T>(fn: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
    await this.init();
    await this.acquire();
    let context: BrowserContext | null = null;
    try {
      const ua = USER_AGENTS[randomBetween(0, USER_AGENTS.length - 1)];
      context = await this.browser!.newContext({
        userAgent: ua,
        locale: "hu-HU",
        timezoneId: "Europe/Budapest",
        viewport: { width: 1366 + randomBetween(0, 200), height: 768 + randomBetween(0, 200) },
        deviceScaleFactor: 1,
        hasTouch: false,
        javaScriptEnabled: true,
        extraHTTPHeaders: {
          "Accept-Language": "hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Upgrade-Insecure-Requests": "1",
        },
      });

      // Stealth: mask webdriver / chrome automation flags
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // @ts-expect-error chrome runtime stub
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, "languages", {
          get: () => ["hu-HU", "hu", "en-US", "en"],
        });
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery(parameters);
      });

      const page = await context.newPage();

      // Block heavy assets for speed (keep CSS for layout-dependent selectors)
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["media", "font", "websocket"].includes(type)) {
          return route.abort();
        }
        // Block common trackers
        const url = route.request().url();
        if (
          /google-analytics|googletagmanager|facebook\.net|hotjar|doubleclick|clarity\.ms/i.test(
            url,
          )
        ) {
          return route.abort();
        }
        return route.continue();
      });

      page.setDefaultTimeout(45_000);
      page.setDefaultNavigationTimeout(45_000);

      return await fn(page, context);
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.release();
    }
  }
}

export async function gotoSmart(page: Page, url: string): Promise<void> {
  await humanDelay(400, 1200);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Small random scroll to look human
  await page.mouse.wheel(0, randomBetween(100, 600));
  await humanDelay(300, 900);
}

export const pool = new BrowserPool();
