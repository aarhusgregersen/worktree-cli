import { exec } from "node:child_process";
import { promisify } from "node:util";
import { type Result, ok } from "../utils/result.js";
import { executeGitCommand } from "./git.js";

const execAsync = promisify(exec);

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

export const isClaudeActive = async (
  worktreePath: string,
): Promise<boolean> => {
  try {
    const { stdout: pgrepOut } = await execAsync("pgrep -x claude");
    const pids = pgrepOut.trim().split("\n").filter(Boolean);

    for (const pid of pids) {
      try {
        const { stdout: lsofOut } = await execAsync(`lsof -p ${pid} -Fn`);
        const cwdLine = lsofOut
          .split("\n")
          .find((l) => l.startsWith("n") && l.includes("cwd"));

        if (cwdLine) {
          const cwd = cwdLine.substring(1);
          if (cwd.startsWith(worktreePath)) return true;
        }
      } catch {
        // lsof may fail for some processes, skip
      }
    }

    return false;
  } catch {
    return false;
  }
};
