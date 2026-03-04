import { Command } from "commander";
import { getLastCommitDate } from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import { listWorktrees } from "../core/worktree.js";
import { formatError } from "../output/formatter.js";
import { printJsonError } from "../output/json.js";
import { renderWorktreeTable } from "../output/table.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List all worktrees")
  .option("--json", "Output as JSON")
  .option("--porcelain", "Machine-readable output")
  .option("-a, --all", "Include main worktree")
  .action(async (options) => {
    if (!isGitRepository()) {
      if (options.json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const result = await listWorktrees();

    if (!result.ok) {
      if (options.json) printJsonError(result.error.message);
      console.error(formatError(result.error.message));
      process.exit(1);
    }

    const worktrees = result.value;
    const filtered = options.all
      ? worktrees
      : worktrees.filter((wt) => !wt.isMain);

    if (options.json) {
      const ages = await Promise.all(
        filtered.map(async (wt) => {
          const lastCommit = await getLastCommitDate("%cI", wt.path);
          return { ...wt, lastCommit };
        }),
      );
      console.log(JSON.stringify(ages, null, 2));
    } else if (options.porcelain) {
      for (const wt of filtered) {
        console.log(`${wt.path}\t${wt.branch ?? "detached"}\t${wt.head}`);
      }
    } else {
      const ages = new Map<string, string>();
      await Promise.all(
        filtered.map(async (wt) => {
          const age = await getLastCommitDate("%cr", wt.path);
          if (age) ages.set(wt.path, age);
        }),
      );
      console.log(renderWorktreeTable(worktrees, options.all ?? false, ages));
    }
  });
