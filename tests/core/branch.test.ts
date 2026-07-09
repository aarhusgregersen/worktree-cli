import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/git.js", () => ({
  executeGitCommand: vi.fn(),
}));
vi.mock("../../src/core/gh.js", () => ({
  isGhAvailable: vi.fn(),
  isPrMerged: vi.fn(),
}));
vi.mock("../../src/core/mergeCache.js", () => ({
  isCachedMerged: vi.fn(),
  cacheMerged: vi.fn(),
}));

import { getDefaultBranch, isBranchMerged } from "../../src/core/branch.js";
import { isGhAvailable, isPrMerged } from "../../src/core/gh.js";
import { executeGitCommand } from "../../src/core/git.js";
import { cacheMerged, isCachedMerged } from "../../src/core/mergeCache.js";

const okResult = (stdout: string) =>
  ({ ok: true, value: { stdout, stderr: "" } }) as const;
const errResult = () =>
  ({ ok: false, error: new Error("git failed") }) as const;

const isArg = (args: readonly string[], ...expected: string[]): boolean =>
  expected.every((value, i) => args[i] === value);

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override.
  vi.mocked(isCachedMerged).mockReturnValue(false);
  vi.mocked(isGhAvailable).mockResolvedValue(false);
  vi.mocked(isPrMerged).mockResolvedValue(false);
});

describe("isBranchMerged resolution order", () => {
  it("returns true from plain --merged without touching cache or gh", async () => {
    vi.mocked(executeGitCommand).mockImplementation(async (args) => {
      if (isArg(args, "branch", "--merged")) {
        return okResult("  main\n* feature-x\n  other\n");
      }
      return errResult();
    });

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(isCachedMerged).not.toHaveBeenCalled();
    expect(isGhAvailable).not.toHaveBeenCalled();
  });

  it("returns true on a persistent cache hit without calling gh", async () => {
    vi.mocked(isCachedMerged).mockReturnValue(true);
    vi.mocked(executeGitCommand).mockImplementation(async (args) => {
      if (isArg(args, "branch", "--merged")) return okResult("  main\n");
      if (isArg(args, "rev-parse", "--git-common-dir")) {
        return okResult("/repo/.git");
      }
      return errResult();
    });

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(isGhAvailable).not.toHaveBeenCalled();
    expect(isPrMerged).not.toHaveBeenCalled();
  });

  it("consults gh when cache misses and caches a MERGED result", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(true);
    vi.mocked(isPrMerged).mockResolvedValue(true);
    vi.mocked(executeGitCommand).mockImplementation(async (args) => {
      if (isArg(args, "branch", "--merged")) return okResult("  main\n");
      if (isArg(args, "rev-parse", "--git-common-dir")) {
        return okResult("/repo/.git");
      }
      return errResult();
    });

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(isPrMerged).toHaveBeenCalledWith("feature-x", undefined);
    expect(cacheMerged).toHaveBeenCalledWith("/repo/.git", "feature-x");
  });

  it("falls back to local squash detection when gh reports not merged", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(true);
    vi.mocked(isPrMerged).mockResolvedValue(false);
    vi.mocked(executeGitCommand).mockImplementation(async (args) => {
      if (isArg(args, "branch", "--merged")) return okResult("  main\n");
      if (isArg(args, "rev-parse", "--git-common-dir")) {
        return okResult("/repo/.git");
      }
      if (isArg(args, "merge-base")) return okResult("basesha");
      if (isArg(args, "rev-parse")) return okResult("treesha");
      if (isArg(args, "commit-tree")) return okResult("tempsha");
      if (isArg(args, "cherry")) return okResult("- abc123");
      return errResult();
    });

    expect(await isBranchMerged("feature-x", "main")).toBe(true);
    expect(cacheMerged).not.toHaveBeenCalled();
  });

  it("returns false when gh is unavailable and local squash detection fails to match", async () => {
    vi.mocked(isGhAvailable).mockResolvedValue(false);
    vi.mocked(executeGitCommand).mockImplementation(async (args) => {
      if (isArg(args, "branch", "--merged")) return okResult("  main\n");
      if (isArg(args, "rev-parse", "--git-common-dir")) {
        return okResult("/repo/.git");
      }
      if (isArg(args, "merge-base")) return okResult("basesha");
      if (isArg(args, "rev-parse")) return okResult("treesha");
      if (isArg(args, "commit-tree")) return okResult("tempsha");
      if (isArg(args, "cherry")) return okResult("+ abc123");
      return errResult();
    });

    expect(await isBranchMerged("feature-x", "main")).toBe(false);
    expect(isPrMerged).not.toHaveBeenCalled();
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
