import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { fail, runCliAction } from "../cliRuntime.js";
import { ErrorCode } from "../core/errors.js";
import { buildWorktreeEnv } from "../core/terminal.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

interface EachResult {
  readonly results: readonly {
    readonly path: string;
    readonly branch: string | undefined;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }[];
}

export const createEachCommand = (): Command =>
  new Command("each")
    .description("Run a command in every worktree")
    .argument("<cmd...>", "Command to run")
    .option("--json", "Output as JSON (captures stdout/stderr)")
    .option("--include-main", "Include the main worktree")
    .option("--bail", "Stop on first non-zero exit code")
    .allowUnknownOption(true)
    .action(async (command: string[], options) => {
      await runCliAction<EachResult>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const [executable, ...args] = command;
          if (!executable) {
            return fail("Command is required", { code: ErrorCode.EXEC_FAILED });
          }
          const all = await requireWorktrees();
          const worktrees = options.includeMain
            ? all
            : all.filter((worktree) => !worktree.isMain);
          const results: EachResult["results"][number][] = [];

          for (const worktree of worktrees) {
            if (reporter.interactive) {
              reporter.info(
                `${worktree.branch ?? "detached"} ${worktree.path}`,
              );
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
            const item = {
              path: worktree.path,
              branch: worktree.branch,
              exitCode: result.status ?? 1,
              stdout: typeof result.stdout === "string" ? result.stdout : "",
              stderr: typeof result.stderr === "string" ? result.stderr : "",
            };
            results.push(item);
            if (options.bail && item.exitCode !== 0) break;
          }
          return { results };
        },
        exitCode: ({ results }) =>
          results.some((result) => result.exitCode !== 0) ? 1 : 0,
      });
    });
