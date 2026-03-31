import { Command } from "commander";
import pc from "picocolors";
import {
  deleteBranch,
  fetchOrigin,
  getDefaultBranch,
  isBranchMerged,
} from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import {
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
} from "../core/worktree.js";
import { formatBranch, formatError, formatPath } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import {
  confirmDestructive,
  intro,
  log,
  outro,
  spinner,
} from "../prompts/interactive.js";

export const pruneCommand = new Command("prune")
  .description(
    "Remove stale worktree entries for directories that no longer exist on disk",
  )
  .option("--dry-run", "Show what would be pruned without doing it")
  .option(
    "--merged",
    "Also remove worktrees for branches merged into default branch",
  )
  .option("--delete-branches", "Delete branches for pruned worktrees")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    // In JSON mode, skip confirmation (act as --yes)
    const skipConfirm = json || options.yes;

    if (!json) intro("wtr prune");

    const s = json ? null : spinner();
    s?.start("Checking for stale worktrees");

    const pruneResult = await pruneWorktrees(true);

    if (!pruneResult.ok) {
      s?.stop(pc.red("Failed"));
      if (json) printJsonError(pruneResult.error.message);
      console.error(formatError(pruneResult.error.message));
      process.exit(1);
    }

    s?.stop("Checked");

    const jsonOutput: {
      pruned: string[];
      mergedRemoved: {
        path: string;
        branch: string | undefined;
        branchDeleted: boolean;
      }[];
    } = { pruned: [], mergedRemoved: [] };

    if (pruneResult.value.length > 0) {
      if (!json)
        log.info(`Found ${pruneResult.value.length} stale worktree entries`);

      if (options.dryRun) {
        if (!json) log.info(`Would prune: ${pruneResult.value.join(", ")}`);
        jsonOutput.pruned = pruneResult.value;
      } else {
        const shouldPrune =
          skipConfirm || (await confirmDestructive("Prune stale entries?"));

        if (shouldPrune) {
          const actualResult = await pruneWorktrees(false);
          if (actualResult.ok) {
            if (!json) log.success("Pruned stale entries");
            jsonOutput.pruned = pruneResult.value;
          }
        }
      }
    } else if (!json) {
      log.info("No stale worktree entries found.");
    }

    if (options.merged) {
      s?.start("Fetching latest from origin");
      await fetchOrigin();
      s?.stop("Fetched");

      s?.start("Checking for merged branches");

      const defaultBranch = await getDefaultBranch();
      const worktreesResult = await listWorktrees();

      if (!worktreesResult.ok) {
        s?.stop(pc.red("Failed"));
        if (json) printJsonError(worktreesResult.error.message);
        console.error(formatError(worktreesResult.error.message));
        process.exit(1);
      }

      const mergedWorktrees: (typeof worktreesResult.value)[number][] = [];

      for (const wt of worktreesResult.value) {
        if (wt.isMain || !wt.branch) continue;

        const merged = await isBranchMerged(wt.branch, defaultBranch);
        if (merged) {
          mergedWorktrees.push(wt);
        }
      }

      s?.stop("Checked");

      if (mergedWorktrees.length === 0) {
        if (!json) log.info("No worktrees with merged branches found.");
      } else {
        if (!json) {
          log.info(
            `Found ${mergedWorktrees.length} worktrees with branches merged into ${formatBranch(defaultBranch)}:`,
          );

          for (const wt of mergedWorktrees) {
            console.log(
              `  ${formatPath(wt.path)} (${formatBranch(wt.branch ?? "unknown")})`,
            );
          }
        }

        if (options.dryRun) {
          if (!json) log.info("Dry run - no changes made.");
          jsonOutput.mergedRemoved = mergedWorktrees.map((wt) => ({
            path: wt.path,
            branch: wt.branch,
            branchDeleted: false,
          }));
        } else {
          const shouldRemove =
            skipConfirm ||
            (await confirmDestructive(
              `Remove ${mergedWorktrees.length} worktrees with merged branches?`,
            ));

          if (shouldRemove) {
            for (const wt of mergedWorktrees) {
              const result = await removeWorktree({
                path: wt.path,
                force: false,
              });

              let branchDeleted = false;

              if (result.ok) {
                if (!json) log.success(`Removed ${formatPath(wt.path)}`);

                if (options.deleteBranches && wt.branch) {
                  // Force-delete because git branch -d refuses to delete
                  // squash-merged branches (it doesn't recognize them as merged)
                  const branchResult = await deleteBranch(wt.branch, true);
                  if (branchResult.ok) {
                    if (!json)
                      log.success(`Deleted branch ${formatBranch(wt.branch)}`);
                    branchDeleted = true;
                  } else if (!json) {
                    log.warning(
                      `Could not delete branch ${wt.branch}: ${branchResult.error.message}`,
                    );
                  }
                }

                jsonOutput.mergedRemoved.push({
                  path: wt.path,
                  branch: wt.branch,
                  branchDeleted,
                });
              } else if (!json) {
                log.warning(
                  `Could not remove ${wt.path}: ${result.error.message}`,
                );
              }
            }
          }
        }
      }
    }

    if (json) {
      printJson(jsonOutput);
    } else {
      outro(pc.green("Prune complete"));
    }
  });
