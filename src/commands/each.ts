import { spawnSync } from "node:child_process";
import { Command } from "commander";
import pc from "picocolors";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import { buildWorktreeEnv } from "../core/terminal.js";
import { listWorktrees } from "../core/worktree.js";
import { formatBranch, formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";

export const eachCommand = new Command("each")
  .description("Run a command in every worktree")
  .argument("<cmd...>", "Command to run")
  .option("--json", "Output as JSON (captures stdout/stderr)")
  .option("--include-main", "Include the main worktree")
  .option("--bail", "Stop on first non-zero exit code")
  .allowUnknownOption(true)
  .action(async (cmd: string[], options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const listResult = await listWorktrees();
    if (!listResult.ok) {
      if (json) printJsonError(listResult.error.message);
      console.error(formatError(listResult.error.message));
      process.exit(1);
    }

    const worktrees = options.includeMain
      ? listResult.value
      : listResult.value.filter((wt) => !wt.isMain);

    if (json) {
      const results: {
        path: string;
        branch: string | undefined;
        exitCode: number;
        stdout: string;
        stderr: string;
      }[] = [];

      for (const wt of worktrees) {
        const wtEnv = buildWorktreeEnv({
          path: wt.path,
          branch: wt.branch,
        });

        const result = spawnSync(cmd[0] as string, cmd.slice(1), {
          cwd: wt.path,
          env: { ...process.env, ...wtEnv },
          encoding: "utf-8",
        });

        const exitCode = result.status ?? 1;
        results.push({
          path: wt.path,
          branch: wt.branch,
          exitCode,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        });

        if (options.bail && exitCode !== 0) break;
      }

      printJson({ results });
    } else {
      let failed = false;
      for (const wt of worktrees) {
        console.log(
          `\n${pc.bold(pc.cyan(`▸ ${formatBranch(wt.branch ?? "detached")}`))} ${pc.dim(wt.path)}`,
        );

        const wtEnv = buildWorktreeEnv({
          path: wt.path,
          branch: wt.branch,
        });

        const result = spawnSync(cmd[0] as string, cmd.slice(1), {
          cwd: wt.path,
          env: { ...process.env, ...wtEnv },
          stdio: "inherit",
        });

        if (options.bail && result.status !== 0) {
          failed = true;
          break;
        }
        if (result.status !== 0) {
          failed = true;
        }
      }

      if (failed) process.exit(1);
    }
  });
