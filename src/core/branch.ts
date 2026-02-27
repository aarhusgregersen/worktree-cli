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

  if (!result.ok) return false;

  return result.value.stdout
    .split("\n")
    .map((b) => b.trim().replace(/^\* /, ""))
    .includes(branchName);
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
