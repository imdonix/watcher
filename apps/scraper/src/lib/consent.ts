import type { Page } from "playwright";
import { humanDelay } from "./util";

/** Dismiss common EU cookie / CMP banners (Didomi, OneTrust, etc.) */
export async function dismissConsent(page: Page): Promise<void> {
  const selectors = [
    "text=Folytatás beleegyezés nélkül",
    "#didomi-notice-agree-button",
    "#didomi-notice-disagree-button",
    "button:has-text('Elfogadom')",
    "button:has-text('Összes elfogadása')",
    "button:has-text('Az összes elfogadása')",
    "button:has-text('Accept all')",
    "button:has-text('Accept')",
    "#onetrust-accept-btn-handler",
    "button[mode='primary']:has-text('Elfogad')",
  ];

  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 800 })) {
        await loc.click({ timeout: 2000 });
        await humanDelay(400, 900);
        return;
      }
    } catch {
      /* try next */
    }
  }
}
