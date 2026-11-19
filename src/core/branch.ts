import { type Result, ok } from "../utils/result.js";
import { type PrInfo, getPrsForBranches, isGhAvailable } from "./gh.js";
import { executeGitCommand, getRepoId } from "./git.js";
import { cacheMerged, isCachedMerged } from "./mergeCache.js";

export const branchExists = async (
  branchName: string,
  cwd?: string,
): Promise<boolean> => {
  const result = await executeGitCommand(
    ["rev-parse", "--verify", `refs/heads/${branchName}`],
    { cwd },
  );
  return result.ok;
};

export const deleteBranch = async (
  branchName: string,
  force: boolean,
  cwd?: string,
): Promise<Result<void, Error>> => {
  const flag = force ? "-D" : "-d";
  const result = await executeGitCommand(["branch", flag, branchName], { cwd });
  return result.ok ? ok(undefined) : result;
};

export interface MergeCheckOptions {
  readonly cwd?: string;
  // Set when the caller already has a fresh PR state, to avoid a second lookup.
  readonly skipGh?: boolean;
}

export const isBranchMerged = async (
  branchName: string,
  targetBranch: string,
  { cwd, skipGh = false }: MergeCheckOptions = {},
): Promise<boolean> => {
  const result = await executeGitCommand(["branch", "--merged", targetBranch], {
    cwd,
  });

  if (result.ok) {
    const merged = result.value.stdout
      .split("\n")
      .map((b) => b.trim().replace(/^\* /, ""))
      .includes(branchName);
    if (merged) return true;
  }

  // Plain --merged only catches fast-forward/merge-commit merges, not GitHub
  // "Squash and merge" (the squashed commit has a new SHA, so the branch's
  // commits are never ancestors of the target). Try the cheap authoritative
  // paths first — persistent cache, then `gh` — before falling back to the
  // expensive local git reconstruction.
  const fast = await fastIsSquashMerged(branchName, cwd, skipGh);
  if (fast === true) return true;

  return isSquashMerged(branchName, targetBranch, cwd);
};

const getBranchTip = async (
  branch: string,
  cwd?: string,
): Promise<string | null> => {
  const result = await executeGitCommand(
    ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
    { cwd },
  );
  return result.ok ? result.value.stdout.trim() : null;
};

// A MERGED PR only proves the commits it carried were merged. A reused branch
// name, or commits added after the merge, leave the local tip outside the PR head.
export const isMergedByPr = async (
  branch: string,
  pr: PrInfo | null | undefined,
  cwd?: string,
): Promise<boolean> => {
  if (pr?.state !== "MERGED" || !pr.headRefOid) return false;
  const tip = await getBranchTip(branch, cwd);
  if (!tip) return false;
  const contained =
    tip === pr.headRefOid ||
    (
      await executeGitCommand(
        ["merge-base", "--is-ancestor", tip, pr.headRefOid],
        { cwd },
      )
    ).ok;
  if (contained) cacheMerged(await getRepoId(cwd), branch, tip);
  return contained;
};

// Fast, authoritative squash-merge check backed by the GitHub PR state.
// Returns true only when we can positively confirm the branch was merged
// (cache hit, or a MERGED PR whose head contains the local tip). Returns null
// when we cannot confirm — gh is missing, unauthenticated, there is no PR, or
// the branch moved on — so the caller falls back to local git detection.
const fastIsSquashMerged = async (
  branch: string,
  cwd: string | undefined,
  skipGh: boolean,
): Promise<boolean | null> => {
  const tip = await getBranchTip(branch, cwd);
  if (!tip) return null;
  if (isCachedMerged(await getRepoId(cwd), branch, tip)) return true;

  if (skipGh || !(await isGhAvailable())) return null;

  const prs = await getPrsForBranches([branch], { cwd });
  return (await isMergedByPr(branch, prs.get(branch), cwd)) ? true : null;
};

const isSquashMerged = async (
  branchName: string,
  targetBranch: string,
  cwd?: string,
): Promise<boolean> => {
  const mergeBase = await executeGitCommand(
    ["merge-base", targetBranch, branchName],
    { cwd },
  );
  if (!mergeBase.ok) return false;

  const tree = await executeGitCommand(["rev-parse", `${branchName}^{tree}`], {
    cwd,
  });
  if (!tree.ok) return false;

  const tempCommit = await executeGitCommand(
    [
      "commit-tree",
      tree.value.stdout.trim(),
      "-p",
      mergeBase.value.stdout.trim(),
      "-m",
      "temp",
    ],
    { cwd },
  );
  if (!tempCommit.ok) return false;

  const cherry = await executeGitCommand(
    ["cherry", targetBranch, tempCommit.value.stdout.trim()],
    { cwd },
  );
  if (!cherry.ok) return false;

  // A "-" prefix means the change is already present in the target branch
  return cherry.value.stdout.trim().startsWith("-");
};

// The default branch is invariant for the lifetime of a CLI invocation, so
// memoize per cwd to avoid re-spawning git across the many callers.
const defaultBranchCache = new Map<string, string>();

export const getDefaultBranch = async (cwd?: string): Promise<string> => {
  const cacheKey = cwd ?? "";
  const cached = defaultBranchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await executeGitCommand(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    { cwd },
  );

  const value = result.ok
    ? result.value.stdout.trim().replace("origin/", "")
    : (await branchExists("main", cwd))
      ? "main"
      : "master";

  defaultBranchCache.set(cacheKey, value);
  return value;
};

export const getCurrentBranch = async (
  cwd?: string,
): Promise<Result<string, Error>> => {
  const result = await executeGitCommand(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    {
      cwd,
    },
  );

  if (!result.ok) return result;
  return ok(result.value.stdout.trim());
};

export const getCommitsBehind = async (
  branchName: string,
  targetBranch: string,
  cwd?: string,
): Promise<number> => {
  const result = await executeGitCommand(
    ["rev-list", "--count", `${branchName}..origin/${targetBranch}`],
    { cwd },
  );
  if (!result.ok) return -1;
  return Number.parseInt(result.value.stdout.trim(), 10);
};

export const getCommitsAhead = async (
  branchName: string,
  targetBranch: string,
  cwd?: string,
): Promise<number> => {
  const result = await executeGitCommand(
    ["rev-list", "--count", `origin/${targetBranch}..${branchName}`],
    { cwd },
  );
  if (!result.ok) return -1; // Unknown, treat as having changes
  return Number.parseInt(result.value.stdout.trim(), 10);
};

export const fetchOrigin = async (
  cwd?: string,
): Promise<Result<void, Error>> => {
  const result = await executeGitCommand(["fetch", "origin"], { cwd });
  return result.ok ? ok(undefined) : result;
};

export const rebaseOnto = async (
  target: string,
  cwd?: string,
): Promise<Result<void, Error>> => {
  const result = await executeGitCommand(["rebase", `origin/${target}`], {
    cwd,
  });
  return result.ok ? ok(undefined) : result;
};

export const mergeFrom = async (
  target: string,
  cwd?: string,
): Promise<Result<void, Error>> => {
  const result = await executeGitCommand(
    ["merge", `origin/${target}`, "--no-edit"],
    { cwd },
  );
  return result.ok ? ok(undefined) : result;
};

export const getLastCommitDate = async (
  format: string,
  cwd?: string,
): Promise<string> => {
  const result = await executeGitCommand(["log", "-1", `--format=${format}`], {
    cwd,
  });
  if (!result.ok) return "";
  return result.value.stdout.trim();
};
