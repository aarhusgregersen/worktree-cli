import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// The module memoizes the parsed cache on first read, so reset the module
// registry between tests to exercise a fresh load each time.
const loadModule = async () => await import("../../src/core/mergeCache.js");

// Entries are keyed by repo id + branch joined with a NUL byte: paths may
// contain spaces, but neither paths nor git refs can contain NUL, so the key
// is unambiguous.
const key = (repoId: string, branch: string) =>
  repoId + String.fromCharCode(0) + branch;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("isCachedMerged", () => {
  it("returns false when the cache file cannot be read", async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const { isCachedMerged } = await loadModule();
    expect(isCachedMerged("/repo/.git", "feature-x")).toBe(false);
  });

  it("returns true for a stored repo + branch entry", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ [key("/repo/.git", "feature-x")]: true }),
    );
    const { isCachedMerged } = await loadModule();
    expect(isCachedMerged("/repo/.git", "feature-x")).toBe(true);
  });

  it("does not collide across repos with the same branch name", async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ [key("/repo-a/.git", "feature-x")]: true }),
    );
    const { isCachedMerged } = await loadModule();
    expect(isCachedMerged("/repo-a/.git", "feature-x")).toBe(true);
    expect(isCachedMerged("/repo-b/.git", "feature-x")).toBe(false);
  });
});

describe("cacheMerged", () => {
  it("persists the entry as a positive result and creates the cache dir", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    const { cacheMerged, isCachedMerged } = await loadModule();

    cacheMerged("/repo/.git", "feature-x");

    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeFileSync).mock.calls[0]?.[1] as string;
    expect(JSON.parse(written)).toEqual({
      [key("/repo/.git", "feature-x")]: true,
    });
    // The in-memory view reflects the new entry immediately.
    expect(isCachedMerged("/repo/.git", "feature-x")).toBe(true);
  });

  it("swallows write failures so the cache stays best-effort", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });
    const { cacheMerged } = await loadModule();

    expect(() => cacheMerged("/repo/.git", "feature-x")).not.toThrow();
  });
});
