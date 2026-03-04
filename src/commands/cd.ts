import { Command } from "commander";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import { findWorktree, listWorktrees } from "../core/worktree.js";
import { formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";

export const cdCommand = new Command("cd")
  .description("Print the path of a worktree (for use with cd)")
  .argument("<id>", "Worktree identifier (branch, path, or # from `wtr ls`)")
  .option("--json", "Output as JSON")
  .action(async (identifier: string, options) => {
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

    if (json) {
      printJson({
        path: worktree.path,
        branch: worktree.branch,
      });
    } else {
      process.stdout.write(`${worktree.path}\n`);
    }
  });
