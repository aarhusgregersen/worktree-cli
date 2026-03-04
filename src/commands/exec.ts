import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import { buildWorktreeEnv } from "../core/terminal.js";
import { findWorktree, listWorktrees } from "../core/worktree.js";
import { formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";

export const execCommand = new Command("exec")
  .description("Run a command in a worktree directory")
  .argument("<id>", "Worktree identifier (branch, path, or # from `wtr ls`)")
  .argument("<cmd...>", "Command to run")
  .option("--json", "Output as JSON (captures stdout/stderr)")
  .allowUnknownOption(true)
  .action(async (identifier: string, cmd: string[], options) => {
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

    const worktree = findWorktree(listResult.value, identifier);
    if (!worktree) {
      if (json)
        printJsonError(
          `Worktree not found: ${identifier}`,
          ErrorCode.WORKTREE_NOT_FOUND,
        );
      console.error(formatError(`Worktree not found: ${identifier}`));
      process.exit(1);
    }

    const wtEnv = buildWorktreeEnv({
      path: worktree.path,
      branch: worktree.branch,
    });

    const env = { ...process.env, ...wtEnv };

    if (json) {
      const result = spawnSync(cmd[0] as string, cmd.slice(1), {
        cwd: worktree.path,
        env,
        encoding: "utf-8",
      });

      printJson({
        path: worktree.path,
        branch: worktree.branch,
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      });
      process.exit(result.status ?? 1);
    }

    const result = spawnSync(cmd[0] as string, cmd.slice(1), {
      cwd: worktree.path,
      env,
      stdio: "inherit",
    });

    process.exit(result.status ?? 1);
  });
