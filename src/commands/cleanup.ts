import Table from "cli-table3";
import { Command } from "commander";
import pc from "picocolors";
import {
  deleteBranch,
  getDefaultBranch,
  isBranchMerged,
} from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { getPrForBranch } from "../core/gh.js";
import { isGitRepository } from "../core/git.js";
import { hasUncommittedChanges } from "../core/status.js";
import { listWorktrees, removeWorktree } from "../core/worktree.js";
import { formatBranch, formatError, formatPath } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import {
  confirmDestructive,
  intro,
  log,
  outro,
  spinner,
} from "../prompts/interactive.js";

interface CleanupCandidate {
  readonly path: string;
  readonly branch: string;
  readonly reason: string;
  readonly dirty: boolean;
}

export const cleanupCommand = new Command("cleanup")
  .description(
    "Remove worktrees whose branches have been merged (via git or PR)",
  )
  .option("--dry-run", "Show candidates without removing")
  .option("--delete-branches", "Also delete associated branches")
  .option(
    "-f, --force",
    "Force removal even if worktree has uncommitted changes",
  )
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

    if (!json) intro("wtr cleanup");

    const s = json ? null : spinner();
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

    const candidates: CleanupCandidate[] = [];

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
          candidates.push({
            path: wt.path,
            branch,
            reason: prMerged ? "PR merged" : "branch merged",
            dirty,
          });
        }
      }),
    );

    s?.stop("Checked");

    if (candidates.length === 0) {
      if (json) {
        printJson({ candidates: [], removed: [], skipped: [] });
      } else {
        log.info("No worktrees with merged branches found.");
        outro("Nothing to clean up");
      }
      return;
    }

    // Separate dirty and clean candidates
    const clean = candidates.filter((c) => !c.dirty || options.force);
    const skipped = options.force ? [] : candidates.filter((c) => c.dirty);

    if (!json) {
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

      if (skipped.length > 0) {
        log.warning(
          `${skipped.length} worktree(s) have uncommitted changes and will be skipped. Use --force to include them.`,
        );
      }
    }

    if (options.dryRun) {
      if (json) {
        printJson({
          candidates: candidates.map((c) => ({
            path: c.path,
            branch: c.branch,
            reason: c.reason,
            dirty: c.dirty,
          })),
          removed: [],
          skipped: skipped.map((c) => ({
            path: c.path,
            branch: c.branch,
            reason: "uncommitted changes",
          })),
        });
      } else {
        log.info("Dry run - no changes made.");
        outro("Dry run complete");
      }
      return;
    }

    if (clean.length === 0) {
      if (json) {
        printJson({
          candidates: candidates.map((c) => ({
            path: c.path,
            branch: c.branch,
            reason: c.reason,
            dirty: c.dirty,
          })),
          removed: [],
          skipped: skipped.map((c) => ({
            path: c.path,
            branch: c.branch,
            reason: "uncommitted changes",
          })),
        });
      } else {
        log.info(
          "All candidates have uncommitted changes. Use --force to remove anyway.",
        );
        outro("Nothing removed");
      }
      return;
    }

    const skipConfirm = json || options.yes;

    if (!skipConfirm) {
      const confirmed = await confirmDestructive(
        `Remove ${clean.length} worktree(s)?`,
      );
      if (!confirmed) {
        outro("Aborted");
        return;
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
        const branchResult = await deleteBranch(c.branch, false);
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
        candidates: candidates.map((c) => ({
          path: c.path,
          branch: c.branch,
          reason: c.reason,
          dirty: c.dirty,
        })),
        removed,
        skipped: skipped.map((c) => ({
          path: c.path,
          branch: c.branch,
          reason: "uncommitted changes",
        })),
      });
    } else {
      outro(pc.green(`Cleaned up ${removed.length} worktree(s)`));
    }
  });
