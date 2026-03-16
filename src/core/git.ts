import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { type Result, err, ok } from "../utils/result.js";

const execFileAsync = promisify(execFile);

interface GitCommandOptions {
  readonly cwd?: string;
  readonly verbose?: boolean;
}

interface GitExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

export const executeGitCommand = async (
  args: readonly string[],
  options?: GitCommandOptions,
): Promise<Result<GitExecResult, Error>> => {
  if (options?.verbose) {
    console.log(`$ git ${args.join(" ")}`);
  }

  try {
    const result = await execFileAsync("git", [...args], {
      cwd: options?.cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return ok(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "stderr" in error
          ? String(error.stderr)
          : String(error);
    return err(new Error(message));
  }
};

export const isGitRepository = (cwd?: string): boolean => {
  try {
    execSync("git rev-parse --git-dir", {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

export const getGitRoot = async (
  cwd?: string,
): Promise<Result<string, Error>> => {
  const result = await executeGitCommand(["rev-parse", "--show-toplevel"], {
    cwd,
  });
  if (!result.ok) return result;
  return ok(result.value.stdout.trim());
};

export const getMainWorktreePath = async (
  cwd?: string,
): Promise<Result<string, Error>> => {
  const result = await executeGitCommand(["worktree", "list", "--porcelain"], {
    cwd,
  });
  if (!result.ok) return result;

  const lines = result.value.stdout.split("\n");
  const firstWorktreeLine = lines.find((line) => line.startsWith("worktree "));
  if (!firstWorktreeLine) {
    return err(new Error("Could not determine main worktree path"));
  }

  return ok(firstWorktreeLine.replace("worktree ", ""));
};
