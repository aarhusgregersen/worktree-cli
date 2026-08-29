import { Command } from "commander";
import { runCliAction } from "../cliRuntime.js";
import { getLastCommitDate } from "../core/branch.js";
import { renderWorktreeTable } from "../output/table.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

export const createListCommand = (): Command =>
  new Command("list")
    .alias("ls")
    .description("List all worktrees")
    .option("--json", "Output as JSON")
    .option("--porcelain", "Machine-readable output")
    .option("-a, --all", "Include main worktree")
    .action(async (options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async () => {
          requireGitRepository();
          const worktrees = await requireWorktrees();
          const filtered = options.all
            ? worktrees
            : worktrees.filter((worktree) => !worktree.isMain);
          const commitDates = await Promise.all(
            filtered.map(async (worktree) => ({
              path: worktree.path,
              iso: await getLastCommitDate("%cI", worktree.path),
              relative: await getLastCommitDate("%cr", worktree.path),
            })),
          );
          return { worktrees, filtered, commitDates };
        },
        renderJson: ({ filtered, commitDates }) =>
          filtered.map((worktree) => ({
            ...worktree,
            lastCommit:
              commitDates.find((date) => date.path === worktree.path)?.iso ??
              "",
          })),
        renderHuman: ({ worktrees, filtered, commitDates }) => {
          if (options.porcelain) {
            for (const worktree of filtered) {
              console.log(
                `${worktree.path}\t${worktree.branch ?? "detached"}\t${worktree.head}`,
              );
            }
            return;
          }
          const ages = new Map(
            commitDates
              .filter((date) => date.relative)
              .map((date) => [date.path, date.relative]),
          );
          console.log(
            renderWorktreeTable(worktrees, options.all ?? false, ages),
          );
        },
      });
    });
