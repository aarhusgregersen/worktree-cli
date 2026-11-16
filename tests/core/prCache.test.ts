import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { readFileSync, writeFileSync } from "node:fs";
import type { PrInfo } from "../../src/core/gh.js";

const loadModule = async () => await import("../../src/core/prCache.js");

const key = (repoId: string, branch: string) =>
  repoId + String.fromCharCode(0) + branch;

const pr = (state: string): PrInfo => ({
  number: 1,
  title: "t",
  url: "u",
  state,
  isDraft: false,
});

const NOW = 1_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("getCachedPr", () => {
  it("returns a fresh entry, including a cached 'no PR'", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        [key("/r", "a")]: { pr: pr("OPEN"), fetchedAt: NOW - 1000 },
        [key("/r", "b")]: { pr: null, fetchedAt: NOW - 1000 },
      }),
    );
    const { getCachedPr } = await loadModule();
    expect(getCachedPr("/r", "a", 60_000, NOW)?.pr?.state).toBe("OPEN");
    expect(getCachedPr("/r", "b", 60_000, NOW)).toEqual({
      pr: null,
      fetchedAt: NOW - 1000,
    });
  });

  it("ignores entries older than maxAge", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        [key("/r", "a")]: { pr: pr("OPEN"), fetchedAt: NOW - 61_000 },
      }),
    );
    const { getCachedPr } = await loadModule();
    expect(getCachedPr("/r", "a", 60_000, NOW)).toBeUndefined();
  });

  it("refetches MERGED when maxAge is 0, so a reused branch name is seen", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        [key("/r", "a")]: { pr: pr("MERGED"), fetchedAt: NOW - 1000 },
      }),
    );
    const { getCachedPr } = await loadModule();
    expect(getCachedPr("/r", "a", 0, NOW)).toBeUndefined();
  });
});

describe("cachePrs", () => {
  it("stores results and prunes stale entries, merged included", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        [key("/r", "old")]: { pr: pr("OPEN"), fetchedAt: NOW - 2 * DAY },
        [key("/r", "done")]: { pr: pr("MERGED"), fetchedAt: NOW - 2 * DAY },
      }),
    );
    const { cachePrs } = await loadModule();

    cachePrs("/r", new Map([["new", null]]), NOW);

    const written = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0]?.[1] as string,
    );
    expect(Object.keys(written)).toEqual(
      [key("/r", "new")],
    );
    expect(written[key("/r", "new")]).toEqual({ pr: null, fetchedAt: NOW });
  });
});
