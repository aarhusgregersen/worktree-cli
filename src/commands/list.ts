import { Command } from "commander";
import { isGitRepository } from "../core/git.js";
import { listWorktrees } from "../core/worktree.js";
import { formatError } from "../output/formatter.js";
import { renderWorktreeJson, renderWorktreeTable } from "../output/table.js";

export const listCommand = new Command("list")
  .alias("ls")
  .description("List all worktrees")
  .option("--json", "Output as JSON")
  .option("--porcelain", "Machine-readable output")
  .option("-a, --all", "Include main worktree")
  .action(async (options) => {
    if (!isGitRepository()) {
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const result = await listWorktrees();

    if (!result.ok) {
      console.error(formatError(result.error.message));
      process.exit(1);
    }

    const worktrees = result.value;

    if (options.json) {
      const filtered = options.all
        ? worktrees
        : worktrees.filter((wt) => !wt.isMain);
      console.log(renderWorktreeJson(filtered));
    } else if (options.porcelain) {
      const filtered = options.all
        ? worktrees
        : worktrees.filter((wt) => !wt.isMain);
      for (const wt of filtered) {
        console.log(`${wt.path}\t${wt.branch ?? "detached"}\t${wt.head}`);
      }
    } else {
      console.log(renderWorktreeTable(worktrees, options.all ?? false));
    }
  });
