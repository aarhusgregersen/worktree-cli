import Table from "cli-table3";
import { Command } from "commander";
import pc from "picocolors";
import {
  deleteBranch,
  fetchOrigin,
  getDefaultBranch,
  isBranchMerged,
} from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { getPrForBranch } from "../core/gh.js";
import { isGitRepository } from "../core/git.js";
import { hasUncommittedChanges } from "../core/status.js";
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

interface MergedCandidate {
  readonly path: string;
  readonly branch: string;
  readonly reason: string;
  readonly dirty: boolean;
}

export const cleanCommand = new Command("clean")
  .description(
    "Clean up worktrees: remove stale entries and merged branches (both by default)",
  )
  .option("--dangling", "Only remove stale entries for missing directories")
  .option(
    "--merged",
    "Only remove worktrees whose branches were merged (via git or PR)",
  )
  .option("--delete-branches", "Also delete associated branches")
  .option(
    "-f, --force",
    "Force removal even if a worktree has uncommitted changes",
  )
  .option("--dry-run", "Show what would be cleaned without doing it")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    // Neither flag => do both. Either flag => scope to just that.
    const both = !options.dangling && !options.merged;
    const doDangling = options.dangling || both;
    const doMerged = options.merged || both;

    if (!json) intro("wtr clean");

    const s = json ? null : spinner();

    // --- Detection phase (dry, no changes yet) ---

    let staleEntries: string[] = [];
    if (doDangling) {
      s?.start("Checking for stale worktrees");
      const pruneResult = await pruneWorktrees(true);
      if (!pruneResult.ok) {
        s?.stop(pc.red("Failed"));
        if (json) printJsonError(pruneResult.error.message);
        console.error(formatError(pruneResult.error.message));
        process.exit(1);
      }
      staleEntries = pruneResult.value;
      s?.stop("Checked");
    }

    let candidates: MergedCandidate[] = [];
    if (doMerged) {
      s?.start("Fetching latest from origin");
      await fetchOrigin();
      s?.stop("Fetched");

      s?.start("Checking worktrees");
      const listResult = await listWorktrees();
      if (!listResult.ok) {
        s?.stop(pc.red("Failed"));
        if (json) printJsonError(listResult.error.message);
        console.error(formatError(listResult.error.message));
        process.exit(1);
      }

      const defaultBranch = await getDefaultBranch();
      const nonMain = listResult.value.filter((wt) => !wt.isMain && wt.branch);
      const found: MergedCandidate[] = [];

      await Promise.all(
        nonMain.map(async (wt) => {
          const branch = wt.branch as string;

          const [merged, prInfo, uncommitted] = await Promise.all([
            isBranchMerged(branch, defaultBranch),
            getPrForBranch(branch, wt.path),
            hasUncommittedChanges(wt.path),
          ]);

          const prMerged = prInfo?.state === "MERGED";
          const dirty = uncommitted.ok ? uncommitted.value.dirty : false;

          if (merged || prMerged) {
            found.push({
              path: wt.path,
              branch,
              reason: prMerged ? "PR merged" : "branch merged",
              dirty,
            });
          }
        }),
      );

      candidates = found;
      s?.stop("Checked");
    }

    const clean = candidates.filter((c) => !c.dirty || options.force);
    const skipped = options.force ? [] : candidates.filter((c) => c.dirty);

    const nothingToDo = staleEntries.length === 0 && clean.length === 0;

    if (nothingToDo && skipped.length === 0) {
      if (json) {
        printJson({ pruned: [], candidates: [], removed: [], skipped: [] });
      } else {
        log.info("Nothing to clean up.");
        outro("Clean");
      }
      return;
    }

    // --- Report what was found ---

    if (!json) {
      if (staleEntries.length > 0) {
        log.info(`Found ${staleEntries.length} stale worktree entries:`);
        for (const entry of staleEntries) {
          console.log(`  ${formatPath(entry)}`);
        }
      }

      if (candidates.length > 0) {
        const table = new Table({
          head: [
            pc.bold("#"),
            pc.bold("Branch"),
            pc.bold("Reason"),
            pc.bold("Dirty"),
          ],
          style: { head: [], border: ["dim"] },
        });

        for (const [i, c] of candidates.entries()) {
          table.push([
            pc.dim(String(i + 1)),
            formatBranch(c.branch),
            c.reason,
            c.dirty ? pc.yellow("Yes") : pc.dim("No"),
          ]);
        }

        console.log(table.toString());
      }

      if (skipped.length > 0) {
        log.warning(
          `${skipped.length} worktree(s) have uncommitted changes and will be skipped. Use --force to include them.`,
        );
      }
    }

    const skippedJson = skipped.map((c) => ({
      path: c.path,
      branch: c.branch,
      reason: "uncommitted changes",
    }));
    const candidatesJson = candidates.map((c) => ({
      path: c.path,
      branch: c.branch,
      reason: c.reason,
      dirty: c.dirty,
    }));

    if (options.dryRun) {
      if (json) {
        printJson({
          pruned: staleEntries,
          candidates: candidatesJson,
          removed: [],
          skipped: skippedJson,
        });
      } else {
        log.info("Dry run - no changes made.");
        outro("Dry run complete");
      }
      return;
    }

    if (nothingToDo) {
      // Only dirty candidates remained; nothing removable without --force.
      if (json) {
        printJson({
          pruned: [],
          candidates: candidatesJson,
          removed: [],
          skipped: skippedJson,
        });
      } else {
        log.info(
          "All candidates have uncommitted changes. Use --force to remove anyway.",
        );
        outro("Nothing removed");
      }
      return;
    }

    // --- Single confirmation for the whole operation ---

    const skipConfirm = json || options.yes;
    if (!skipConfirm) {
      const parts: string[] = [];
      if (staleEntries.length > 0)
        parts.push(`prune ${staleEntries.length} stale entr(y/ies)`);
      if (clean.length > 0) parts.push(`remove ${clean.length} worktree(s)`);

      const confirmed = await confirmDestructive(
        `Clean up: ${parts.join(" and ")}?`,
      );
      if (!confirmed) {
        outro("Aborted");
        return;
      }
    }

    // --- Execute: dangling first, then merged ---

    let pruned: string[] = [];
    if (staleEntries.length > 0) {
      const actualResult = await pruneWorktrees(false);
      if (actualResult.ok) {
        pruned = staleEntries;
        if (!json) log.success("Pruned stale entries");
      } else if (!json) {
        log.warning(
          `Could not prune stale entries: ${actualResult.error.message}`,
        );
      }
    }

    const removed: { path: string; branch: string; branchDeleted: boolean }[] =
      [];

    for (const c of clean) {
      s?.start(`Removing ${formatPath(c.path)}`);

      const result = await removeWorktree({
        path: c.path,
        force: options.force ?? false,
      });

      if (!result.ok) {
        s?.stop(pc.yellow("Failed"));
        if (!json)
          log.warning(`Could not remove ${c.path}: ${result.error.message}`);
        continue;
      }

      let branchDeleted = false;

      if (options.deleteBranches) {
        // Force-delete because git branch -d refuses to delete squash-merged
        // branches (it doesn't recognize them as merged)
        const branchResult = await deleteBranch(c.branch, true);
        if (branchResult.ok) {
          branchDeleted = true;
        }
      }

      s?.stop(pc.green("Removed"));
      if (!json) {
        log.success(
          `Removed ${formatPath(c.path)} (${formatBranch(c.branch)})${branchDeleted ? " + deleted branch" : ""}`,
        );
      }

      removed.push({ path: c.path, branch: c.branch, branchDeleted });
    }

    if (json) {
      printJson({
        pruned,
        candidates: candidatesJson,
        removed,
        skipped: skippedJson,
      });
    } else {
      const summary: string[] = [];
      if (pruned.length > 0) summary.push(`pruned ${pruned.length} stale`);
      if (removed.length > 0)
        summary.push(`removed ${removed.length} worktree(s)`);
      outro(pc.green(`Cleaned up: ${summary.join(", ") || "nothing"}`));
    }
  });
