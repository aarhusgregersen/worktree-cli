import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFile: execFileMock }));
vi.mock("../../src/core/git.js", () => ({
  executeGitCommand: vi.fn(),
  getRepoId: vi.fn(async () => "/repo/.git"),
}));
vi.mock("../../src/core/mergeCache.js", () => ({ cacheMerged: vi.fn() }));
vi.mock("../../src/core/prCache.js", () => ({
  getCachedPr: vi.fn(),
  cachePrs: vi.fn(),
}));

import { getPrsForBranches } from "../../src/core/gh.js";
import { cacheMerged } from "../../src/core/mergeCache.js";
import { cachePrs, getCachedPr } from "../../src/core/prCache.js";

const node = (number: number, state: string, isCrossRepository = false) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state,
  isDraft: false,
  isCrossRepository,
});

const respond = (repository: Record<string, unknown>) => {
  execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
    callback(null, { stdout: JSON.stringify({ data: { repository } }) });
  });
};

const ghArgs = (call = 0): string[] => execFileMock.mock.calls[call]?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCachedPr).mockReturnValue(undefined);
});

describe("getPrsForBranches", () => {
  it("looks up every branch in a single gh call", async () => {
    respond({
      b0: { nodes: [node(2, "OPEN")] },
      b1: { nodes: [] },
    });

    const prs = await getPrsForBranches(["feat-a", "feat-b"]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(ghArgs()).toEqual(
      expect.arrayContaining(["api", "graphql", "b0=feat-a", "b1=feat-b"]),
    );
    expect(prs.get("feat-a")?.number).toBe(2);
    expect(prs.get("feat-b")).toBeNull();
    expect(cachePrs).toHaveBeenCalledWith("/repo/.git", prs);
  });

  it("prefers an open PR over a newer closed one", async () => {
    respond({ b0: { nodes: [node(5, "CLOSED"), node(4, "OPEN")] } });
    const prs = await getPrsForBranches(["feat-a"]);
    expect(prs.get("feat-a")?.number).toBe(4);
  });

  it("ignores PRs opened from forks with the same branch name", async () => {
    respond({
      b0: { nodes: [node(9, "MERGED", true)] },
      b1: { nodes: [node(8, "OPEN", true), node(7, "CLOSED")] },
    });
    const prs = await getPrsForBranches(["patch-1", "patch-2"]);
    expect(prs.get("patch-1")).toBeNull();
    expect(prs.get("patch-2")).toEqual({
      number: 7,
      title: "PR 7",
      url: "https://github.com/o/r/pull/7",
      state: "CLOSED",
      isDraft: false,
    });
    expect(cacheMerged).not.toHaveBeenCalled();
  });

  it("serves cached branches without calling gh", async () => {
    vi.mocked(getCachedPr).mockReturnValue({
      pr: node(1, "OPEN"),
      fetchedAt: 0,
    });
    const prs = await getPrsForBranches(["feat-a"], { maxAgeMs: 60_000 });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(prs.get("feat-a")?.number).toBe(1);
  });

  it("records MERGED PRs in the merged cache", async () => {
    respond({ b0: { nodes: [node(3, "MERGED")] } });
    await getPrsForBranches(["feat-a"]);
    expect(cacheMerged).toHaveBeenCalledWith("/repo/.git", "feat-a");
  });

  it("omits branches and caches nothing when gh fails", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error("gh: not logged in"));
    });
    const prs = await getPrsForBranches(["feat-a"]);
    expect(prs.has("feat-a")).toBe(false);
    expect(cachePrs).not.toHaveBeenCalled();
  });

  it("splits large lookups into chunks of 50", async () => {
    respond({});
    const branches = Array.from({ length: 120 }, (_, i) => `b-${i}`);
    await getPrsForBranches(branches);
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });
});
