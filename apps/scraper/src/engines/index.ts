import { ENGINES } from "@watcher/shared";
import type { EngineScraper } from "./types";
import { jofogasEngine } from "./jofogas";
import { ingatlanEngine } from "./ingatlan";
import { autoEngine } from "./auto";

const scrapers: EngineScraper[] = [jofogasEngine, ingatlanEngine, autoEngine];

export function getScraper(slugOrName: string): EngineScraper | undefined {
  const key = slugOrName.toLowerCase();
  return scrapers.find(
    (s) => s.slug.toLowerCase() === key || s.name.toLowerCase() === key,
  );
}

export function listEngines() {
  return ENGINES;
}

export { scrapers };
