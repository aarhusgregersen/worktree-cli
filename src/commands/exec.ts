import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { fail, runCliAction } from "../cliRuntime.js";
import { ErrorCode } from "../core/errors.js";
import { buildWorktreeEnv } from "../core/terminal.js";
import {
  requireGitRepository,
  requireWorktrees,
  resolveWorktreeTarget,
} from "./shared.js";

interface ExecResult {
  readonly path: string;
  readonly branch: string | undefined;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const createExecCommand = (): Command =>
  new Command("exec")
    .description("Run a command in a worktree directory")
    .argument("<id>", "Worktree identifier (branch, path, or # from `wtr ls`)")
    .argument("<cmd...>", "Command to run")
    .option("--json", "Output as JSON (captures stdout/stderr)")
    .allowUnknownOption(true)
    .action(async (identifier: string, command: string[], options) => {
      await runCliAction<ExecResult>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktree = await resolveWorktreeTarget({
            worktrees: await requireWorktrees(),
            identifier,
            reporter,
          });
          const [executable, ...args] = command;
          if (!executable) {
            return fail("Command is required", { code: ErrorCode.EXEC_FAILED });
          }
          const result = spawnSync(executable, args, {
            cwd: worktree.path,
            env: {
              ...process.env,
              ...buildWorktreeEnv({
                path: worktree.path,
                branch: worktree.branch,
              }),
            },
            ...(reporter.interactive
              ? { stdio: "inherit" as const }
              : { encoding: "utf-8" as const }),
          });
          return {
            path: worktree.path,
            branch: worktree.branch,
            exitCode: result.status ?? 1,
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
          };
        },
        exitCode: (result) => result.exitCode,
      });
    });
