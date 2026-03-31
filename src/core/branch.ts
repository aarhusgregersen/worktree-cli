import { type Result, ok } from "../utils/result.js";
import { executeGitCommand } from "./git.js";

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

export const isBranchMerged = async (
  branchName: string,
  targetBranch: string,
  cwd?: string,
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

  // Fall back to squash-merge detection: create a temporary commit that
  // represents the branch squashed onto the merge-base, then use git-cherry
  // to check whether that change already exists in the target. This handles
  // GitHub "Squash and merge" where the original commits are not ancestors
  // of the target branch.
  return isSquashMerged(branchName, targetBranch, cwd);
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

  const tree = await executeGitCommand(
    ["rev-parse", `${branchName}^{tree}`],
    { cwd },
  );
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

export const getDefaultBranch = async (cwd?: string): Promise<string> => {
  const result = await executeGitCommand(
    ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    { cwd },
  );

  if (result.ok) {
    return result.value.stdout.trim().replace("origin/", "");
  }

  const mainExists = await branchExists("main", cwd);
  return mainExists ? "main" : "master";
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
  const result = await executeGitCommand(
    ["log", "-1", `--format=${format}`],
    { cwd },
  );
  if (!result.ok) return "";
  return result.value.stdout.trim();
};
