import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/git.js", () => ({
  executeGitCommand: vi.fn(),
  getRepoId: vi.fn(async () => "/repo/.git"),
}));
vi.mock("../../src/core/gh.js", () => ({
  isGhAvailable: vi.fn(),
  getPrsForBranches: vi.fn(),
}));
vi.mock("../../src/core/mergeCache.js", () => ({
  isCachedMerged: vi.fn(),
  cacheMerged: vi.fn(),
}));

import {
  getDefaultBranch,
  isBranchMerged,
  isMergedByPr,
} from "../../src/core/branch.js";
import {
  type PrInfo,
  getPrsForBranches,
  isGhAvailable,
} from "../../src/core/gh.js";
import { executeGitCommand } from "../../src/core/git.js";
import { cacheMerged, isCachedMerged } from "../../src/core/mergeCache.js";

const okResult = (stdout: string) =>
  ({ ok: true, value: { stdout, stderr: "" } }) as const;
const errResult = () =>
  ({ ok: false, error: new Error("git failed") }) as const;

const isArg = (args: readonly string[], ...expected: string[]): boolean =>
  expected.every((value, i) => args[i] === value);

const TIP = "tip111";

const mergedPr = (headRefOid: string): PrInfo => ({
  number: 12,
  title: "t",
  url: "u",
  state: "MERGED",
  isDraft: false,
  headRefOid,
});

type GitHandler = (
  args: readonly string[],
) => ReturnType<typeof okResult> | ReturnType<typeof errResult> | undefined;

// Branch tip resolves to TIP and nothing is merged unless `extra` says so.
const mockGit = (extra: GitHandler = () => undefined) => {
  vi.mocked(executeGitCommand).mockImplementation(async (args) => {
    const handled = extra(args);
    if (handled) return handled;
    if (isArg(args, "branch", "--merged")) return okResult("  main\n");
    if (isArg(args, "rev-parse", "--verify")) return okResult(TIP);
    return errResult();
  });
};

const squashDetection =
  (cherry: string): GitHandler =>
  (args) => {
    if (isArg(args, "merge-base", "main")) return okResult("basesha");
    if (isArg(args, "rev-parse") && args[1]?.endsWith("^{tree}")) {
      return okResult("treesha");
    }
    if (isArg(args, "commit-tree")) return okResult("tempsha");
    if (isArg(args, "cherry")) return okResult(cherry);
    return undefined;
  };

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override.
  vi.mocked(isCachedMerged).mockReturnValue(false);
  vi.mocked(isGhAvailable).mockResolvedValue(false);
  vi.mocked(getPrsForBranches).mockResolvedValue(new Map());
});

describe("isBranchMerged resolution order", () => {
  it("returns true from plain --merged without touching cache or gh", async () => {
    mockGit((args) =>
      isArg(args, "branch", "--merged")
        ? okResult("  main\n* feature-x\n  other\n")
        : undefined,
    );

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(isCachedMerged).not.toHaveBeenCalled();
    expect(isGhAvailable).not.toHaveBeenCalled();
  });

  it("returns true on a cache hit for the current tip without calling gh", async () => {
    vi.mocked(isCachedMerged).mockReturnValue(true);
    mockGit();

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(isCachedMerged).toHaveBeenCalledWith("/repo/.git", "feature-x", TIP);
    expect(getPrsForBranches).not.toHaveBeenCalled();
  });

  it("consults gh on a cache miss and caches the merged tip", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(true);
    vi.mocked(getPrsForBranches).mockResolvedValue(
      new Map([["feature-x", mergedPr(TIP)]]),
    );
    mockGit();

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(cacheMerged).toHaveBeenCalledWith("/repo/.git", "feature-x", TIP);
  });

  it("falls back to local squash detection when gh reports not merged", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(true);
    mockGit(squashDetection("- abc123"));

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(cacheMerged).not.toHaveBeenCalled();
  });

  it("skips gh when the caller already has a fresh PR state", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(true);
    mockGit(squashDetection("+ abc123"));

    expect(await isBranchMerged("feature-x", "main", { skipGh: true })).toBe(
      false,
    );
    expect(isGhAvailable).not.toHaveBeenCalled();
    expect(getPrsForBranches).not.toHaveBeenCalled();
  });

  it("returns false when gh is unavailable and local squash detection fails to match", async () => {
    mockGit(squashDetection("+ abc123"));

    expect(await isBranchMerged("feature-x", "main")).toBe(false);
    expect(getPrsForBranches).not.toHaveBeenCalled();
  });

  it("does not treat a reused branch name as merged by its old PR", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(true);
    vi.mocked(getPrsForBranches).mockResolvedValue(
      new Map([["feature-x", mergedPr("oldhead")]]),
    );
    mockGit(squashDetection("+ abc123"));

    expect(await isBranchMerged("feature-x", "main")).toBe(false);
    expect(cacheMerged).not.toHaveBeenCalled();
  });
});

describe("isMergedByPr", () => {
  it("is true when the local tip is the merged PR head", async () => {
    mockGit();
    expect(await isMergedByPr("feature-x", mergedPr(TIP))).toBe(true);
  });

  it("is true when the local tip is an ancestor of the merged PR head", async () => {
    mockGit((args) =>
      isArg(args, "merge-base", "--is-ancestor", TIP, "newerhead")
        ? okResult("")
        : undefined,
    );
    expect(await isMergedByPr("feature-x", mergedPr("newerhead"))).toBe(true);
    expect(cacheMerged).toHaveBeenCalledWith("/repo/.git", "feature-x", TIP);
  });

  it("is false when the branch has commits the PR never carried", async () => {
    mockGit();
    expect(await isMergedByPr("feature-x", mergedPr("oldhead"))).toBe(false);
    expect(cacheMerged).not.toHaveBeenCalled();
  });

  it("is false for open PRs and PRs without a head SHA", async () => {
    mockGit();
    expect(
      await isMergedByPr("feature-x", { ...mergedPr(TIP), state: "OPEN" }),
    ).toBe(false);
    expect(
      await isMergedByPr("feature-x", {
        ...mergedPr(TIP),
        headRefOid: undefined,
      }),
    ).toBe(false);
  });
});

describe("getDefaultBranch", () => {
  it("reads origin/HEAD and strips the origin/ prefix", async () => {
    vi.mocked(executeGitCommand).mockResolvedValue(okResult("origin/develop"));
    expect(await getDefaultBranch("/repo-a")).toBe("develop");
  });

  it("memoizes per cwd so git is only spawned once", async () => {
    vi.mocked(executeGitCommand).mockResolvedValue(okResult("origin/main"));

    expect(await getDefaultBranch("/repo-memo")).toBe("main");
    expect(await getDefaultBranch("/repo-memo")).toBe("main");
    expect(executeGitCommand).toHaveBeenCalledTimes(1);
  });

  it("falls back to master when origin/HEAD and main are both absent", async () => {
    vi.mocked(executeGitCommand).mockResolvedValue(errResult());
    expect(await getDefaultBranch("/repo-fallback")).toBe("master");
  });
});
