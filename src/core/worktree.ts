import { type Result, ok } from "../utils/result.js";
import { executeGitCommand } from "./git.js";

export interface WorktreeInfo {
  readonly path: string;
  readonly head: string;
  readonly branch: string | undefined;
  readonly isLocked: boolean;
  readonly isPrunable: boolean;
  readonly isMain: boolean;
  readonly isDetached: boolean;
}

export const listWorktrees = async (
  cwd?: string,
): Promise<Result<readonly WorktreeInfo[], Error>> => {
  const result = await executeGitCommand(["worktree", "list", "--porcelain"], {
    cwd,
  });

  if (!result.ok) return result;

  const worktrees = parseWorktreeOutput(result.value.stdout);
  return ok(worktrees);
};

export const addWorktree = async (options: {
  readonly path: string;
  readonly branch: string;
  readonly createBranch: boolean;
  readonly forceCreate: boolean;
  readonly baseRef?: string;
  readonly detach: boolean;
  readonly cwd?: string;
}): Promise<Result<void, Error>> => {
  const args = ["worktree", "add"];

  if (options.detach) {
    args.push("--detach");
    args.push(options.path);
    args.push(options.branch);
  } else if (options.forceCreate) {
    args.push("-B", options.branch);
    args.push(options.path);
    if (options.baseRef) {
      args.push("--no-track", options.baseRef);
    }
  } else if (options.createBranch) {
    args.push("-b", options.branch);
    args.push(options.path);
    if (options.baseRef) {
      args.push("--no-track", options.baseRef);
    }
  } else {
    args.push(options.path);
    args.push(options.branch);
  }

  const result = await executeGitCommand(args, { cwd: options.cwd });
  return result.ok ? ok(undefined) : result;
};

export const removeWorktree = async (options: {
  readonly path: string;
  readonly force: boolean;
  readonly cwd?: string;
}): Promise<Result<void, Error>> => {
  const args = ["worktree", "remove"];
  if (options.force) args.push("--force");
  args.push(options.path);

  const result = await executeGitCommand(args, { cwd: options.cwd });
  return result.ok ? ok(undefined) : result;
};

export const pruneWorktrees = async (
  dryRun: boolean,
  cwd?: string,
): Promise<Result<string[], Error>> => {
  const args = ["worktree", "prune"];
  if (dryRun) args.push("--dry-run", "-v");

  const result = await executeGitCommand(args, { cwd });
  if (!result.ok) return result;

  const prunedPaths = parsePruneOutput(
    result.value.stdout + result.value.stderr,
  );
  return ok(prunedPaths);
};

export const findWorktree = (
  worktrees: readonly WorktreeInfo[],
  identifier: string,
): WorktreeInfo | undefined => {
  // Try numeric ID first (matches # column from `wtr ls`)
  const index = /^\d+$/.test(identifier)
    ? Number.parseInt(identifier, 10)
    : Number.NaN;

  if (!Number.isNaN(index)) {
    const nonMain = worktrees.filter((wt) => !wt.isMain);
    return nonMain[index - 1];
  }

  // Try full path or directory name match
  const byPath = worktrees.find(
    (wt) => wt.path === identifier || wt.path.endsWith(`/${identifier}`),
  );
  if (byPath) return byPath;

  // Try branch name match
  return worktrees.find((wt) => wt.branch === identifier);
};

export const isInsideWorktree = (
  worktrees: readonly WorktreeInfo[],
  cwd: string,
): WorktreeInfo | undefined =>
  worktrees.find(
    (wt) => !wt.isMain && (cwd === wt.path || cwd.startsWith(`${wt.path}/`)),
  );

export const parseWorktreeOutput = (output: string): readonly WorktreeInfo[] => {
  const entries = output.split("\n\n").filter(Boolean);
  let isFirst = true;

  return entries.map((entry) => {
    const info = parseWorktreeEntry(entry, isFirst);
    isFirst = false;
    return info;
  });
};

export const parseWorktreeEntry = (entry: string, isMain: boolean): WorktreeInfo => {
  const lines = entry.split("\n");
  const data: Record<string, string | boolean> = {};

  for (const line of lines) {
    if (line === "locked") {
      data["locked"] = true;
    } else if (line === "prunable") {
      data["prunable"] = true;
    } else if (line === "detached") {
      data["detached"] = true;
    } else if (line === "bare") {
      data["bare"] = true;
    } else {
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex !== -1) {
        const key = line.substring(0, spaceIndex);
        const value = line.substring(spaceIndex + 1);
        data[key] = value;
      }
    }
  }

  const branch =
    typeof data["branch"] === "string"
      ? data["branch"].replace("refs/heads/", "")
      : undefined;

  return {
    path: typeof data["worktree"] === "string" ? data["worktree"] : "",
    head: typeof data["HEAD"] === "string" ? data["HEAD"] : "",
    branch,
    isLocked: data["locked"] === true,
    isPrunable: data["prunable"] === true,
    isMain,
    isDetached: data["detached"] === true,
  };
};

export const parsePruneOutput = (output: string): string[] => {
  return output
    .split("\n")
    .filter((line) => line.includes("Removing") || line.includes("Pruning"))
    .map((line) => {
      const match = line.match(/worktrees\/(\S+)/);
      return match?.[1] ?? line.trim();
    })
    .filter((s): s is string => Boolean(s));
};
