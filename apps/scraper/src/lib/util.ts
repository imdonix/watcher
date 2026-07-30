export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function humanDelay(minMs = 800, maxMs = 2200): Promise<void> {
  await sleep(randomBetween(minMs, maxMs));
}

export function parsePriceHu(text: string | null | undefined): number | null {
  if (!text) return null;
  const original = text.replace(/\u00a0/g, " ").trim();
  const lower = original.toLowerCase();

  let mult = 1;
  if (/\bmillió\b|\bmillion\b|\b\d+[.,]?\d*\s*m\b/i.test(lower)) mult = 1_000_000;
  else if (/\bezer\b|\bthousand\b/i.test(lower)) mult = 1_000;

  // Strip currency words, then remove thousand-separating spaces/dots
  // "209 000 Ft" → "209000", "12,5 M" → "12.5" * 1e6
  let normalized = original
    .replace(/Ft|HUF|€|EUR/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // European decimal: "12,5" with million marker
  if (mult > 1) {
    const m = normalized.match(/(\d+[.,]\d+|\d+)/);
    if (!m) return null;
    const base = Number(m[1].replace(",", "."));
    return Number.isFinite(base) ? Math.floor(base * mult) : null;
  }

  // Integer HUF with space/dot thousand separators: "209 000" / "1.250.000"
  const digits = normalized.replace(/[.\s]/g, "").replace(/,/g, "");
  const onlyNum = digits.replace(/[^\d]/g, "");
  if (!onlyNum) return null;
  const n = Number(onlyNum);
  return Number.isFinite(n) ? n : null;
}

export function absoluteUrl(base: string, href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
