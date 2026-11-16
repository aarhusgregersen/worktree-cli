import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PR_CACHE_PATH } from "../config/schema.js";
import type { PrInfo } from "./gh.js";

// "No PR" is cached too, otherwise branches without a PR always hit the network.

interface PrCacheEntry {
  readonly pr: PrInfo | null;
  readonly fetchedAt: number;
}

type PrCache = Record<string, PrCacheEntry>;

const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

let cache: PrCache | null = null;

const load = (): PrCache => {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(PR_CACHE_PATH, "utf-8")) as PrCache;
  } catch {
    cache = {};
  }
  return cache;
};

const makeKey = (repoId: string, branch: string): string =>
  `${repoId}\0${branch}`;

export const getCachedPr = (
  repoId: string,
  branch: string,
  maxAgeMs: number,
  now = Date.now(),
): PrCacheEntry | undefined => {
  const entry = load()[makeKey(repoId, branch)];
  if (!entry) return undefined;
  return now - entry.fetchedAt < maxAgeMs ? entry : undefined;
};

export const cachePrs = (
  repoId: string,
  prs: ReadonlyMap<string, PrInfo | null>,
  now = Date.now(),
): void => {
  const c = load();
  for (const [key, entry] of Object.entries(c)) {
    if (now - entry.fetchedAt > PRUNE_AFTER_MS) {
      delete c[key];
    }
  }
  for (const [branch, pr] of prs) {
    c[makeKey(repoId, branch)] = { pr, fetchedAt: now };
  }
  try {
    mkdirSync(dirname(PR_CACHE_PATH), { recursive: true });
    writeFileSync(PR_CACHE_PATH, JSON.stringify(c));
  } catch {
    // Best-effort: a failed write just means the next run fetches again.
  }
};
