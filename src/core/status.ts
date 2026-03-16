import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Result, ok } from "../utils/result.js";
import { executeGitCommand } from "./git.js";

const execFileAsync = promisify(execFile);

export interface DiffStat {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface UncommittedStatus {
  readonly dirty: boolean;
  readonly untrackedCount: number;
}

export const getDiffStat = async (
  branch: string,
  baseBranch: string,
  cwd?: string,
): Promise<Result<DiffStat, Error>> => {
  const result = await executeGitCommand(
    ["diff", "--numstat", `origin/${baseBranch}...${branch}`],
    { cwd },
  );

  if (!result.ok) return result;

  const lines = result.value.stdout.trim().split("\n").filter(Boolean);
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    const parts = line.split("\t");
    const added = parts[0] ?? "-";
    const removed = parts[1] ?? "-";
    if (added !== "-") insertions += Number.parseInt(added, 10);
    if (removed !== "-") deletions += Number.parseInt(removed, 10);
  }

  return ok({
    filesChanged: lines.length,
    insertions,
    deletions,
  });
};

export const hasUncommittedChanges = async (
  worktreePath: string,
): Promise<Result<UncommittedStatus, Error>> => {
  const result = await executeGitCommand(["status", "--porcelain"], {
    cwd: worktreePath,
  });

  if (!result.ok) return result;

  const lines = result.value.stdout.trim().split("\n").filter(Boolean);
  const untrackedCount = lines.filter((l) => l.startsWith("??")).length;

  return ok({
    dirty: lines.length > 0,
    untrackedCount,
  });
};

export const isBranchPushed = async (
  branch: string,
  cwd?: string,
): Promise<boolean> => {
  const result = await executeGitCommand(
    ["rev-parse", "--verify", `origin/${branch}`],
    { cwd },
  );
  return result.ok;
};

/**
 * Get the working directories of all running Claude processes.
 * Call once and reuse the result to check multiple worktrees.
 */
export const getClaudeCwds = async (): Promise<readonly string[]> => {
  try {
    const { stdout: pgrepOut } = await execFileAsync("pgrep", ["-x", "claude"]);
    const pids = pgrepOut.trim().split("\n").filter(Boolean);
    if (pids.length === 0) return [];

    const cwds = await Promise.all(
      pids.map(async (pid) => {
        try {
          const { stdout: lsofOut } = await execFileAsync("lsof", [
            "-a",
            "-d",
            "cwd",
            "-p",
            pid,
            "-Fn",
          ]);
          const cwdLine = lsofOut
            .split("\n")
            .find((l) => l.startsWith("n/"));
          return cwdLine ? cwdLine.substring(1) : null;
        } catch {
          return null;
        }
      }),
    );

    return cwds.filter((c): c is string => c !== null);
  } catch {
    return [];
  }
};

export const isClaudeActive = (
  claudeCwds: readonly string[],
  worktreePath: string,
): boolean => {
  return claudeCwds.some(
    (cwd) => cwd === worktreePath || cwd.startsWith(`${worktreePath}/`),
  );
};
