import { Command } from "commander";
import pc from "picocolors";
import { runCliAction } from "../cliRuntime.js";
import {
  deleteBranch,
  getCommitsAhead,
  getDefaultBranch,
  isBranchMerged,
} from "../core/branch.js";
import { CliCancelled, CliError, ErrorCode } from "../core/errors.js";
import { removeManagedWorktree } from "../core/lifecycle.js";
import { formatBranch, formatPath } from "../output/formatter.js";
import { confirmDestructive } from "../prompts/interactive.js";
import {
  requireGitRepository,
  requireWorktrees,
  resolveWorktreeTarget,
} from "./shared.js";

export const createRemoveCommand = (): Command =>
  new Command("remove")
    .alias("rm")
    .description("Remove a worktree")
    .argument(
      "[path-or-id]",
      "Worktree path, directory name, or # from `wtr ls`",
    )
    .option("-f, --force", "Force removal even with uncommitted changes")
    .option("--delete-branch", "Also delete the associated branch")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktree = await resolveWorktreeTarget({
            worktrees: await requireWorktrees(),
            identifier,
            reporter,
          });
          if (worktree.isMain) {
            throw new CliError("Cannot remove the main worktree", {
              code: ErrorCode.CANNOT_REMOVE_MAIN,
            });
          }
          if (worktree.isLocked && !options.force) {
            throw new CliError("Worktree is locked. Use --force to remove.", {
              code: ErrorCode.WORKTREE_LOCKED,
            });
          }

          reporter.intro("wtr remove");
          if (reporter.interactive && !options.yes) {
            const confirmed = await confirmDestructive(
              options.deleteBranch && worktree.branch
                ? `Remove worktree at ${formatPath(worktree.path)} and delete branch ${formatBranch(worktree.branch)}?`
                : `Remove worktree at ${formatPath(worktree.path)}?`,
              { initialValue: true, activeLabel: "Yes (recommended)" },
            );
            if (!confirmed) {
              reporter.outro("Aborted");
              throw new CliCancelled();
            }
          }

          const progress = reporter.spinner();
          progress.start(`Removing ${formatPath(worktree.path)}`);
          const removed = await removeManagedWorktree({
            worktree,
            force: options.force ?? false,
          });
          if (!removed.ok) throw removed.error;
          progress.stop(pc.green("Worktree removed"));
          if (removed.value.orphanedDatabase) {
            reporter.warning(
              `Database ${removed.value.orphanedDatabase} could not be dropped and is now orphaned.`,
            );
          }

          let branchDeleted = false;
          if (options.deleteBranch && worktree.branch) {
            const deleted = await deleteBranch(worktree.branch, true);
            if (deleted.ok) branchDeleted = true;
            else reporter.warning(deleted.error.message);
          } else if (worktree.branch && reporter.interactive && !options.yes) {
            const defaultBranch = await getDefaultBranch();
            const [merged, commitsAhead] = await Promise.all([
              isBranchMerged(worktree.branch, defaultBranch),
              getCommitsAhead(worktree.branch, defaultBranch),
            ]);
            const clean = merged || commitsAhead === 0;
            const shouldDelete = await confirmDestructive(
              `Delete branch ${formatBranch(worktree.branch)}?`,
              {
                initialValue: clean,
                activeLabel: merged
                  ? "Yes (recommended, branch is merged)"
                  : commitsAhead === 0
                    ? "Yes (recommended, no changes)"
                    : "Yes (has unmerged changes)",
              },
            );
            if (shouldDelete) {
              const deleted = await deleteBranch(worktree.branch, !clean);
              if (deleted.ok) branchDeleted = true;
              else reporter.warning(deleted.error.message);
            }
          }

          return { ...removed.value, branchDeleted };
        },
        renderHuman: ({ path }, reporter) =>
          reporter.outro(`Removed worktree at ${formatPath(path)}`),
      });
    });
