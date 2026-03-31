import { Command } from "commander";
import pc from "picocolors";
import {
  deleteBranch,
  getCommitsAhead,
  getDefaultBranch,
  isBranchMerged,
} from "../core/branch.js";
import { dropDatabase, readWorktreeDb } from "../core/database.js";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import {
  type WorktreeInfo,
  findWorktree,
  listWorktrees,
  removeWorktree,
} from "../core/worktree.js";
import {
  formatBranch,
  formatError,
  formatPath,
  formatWarning,
} from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import {
  confirmDestructive,
  intro,
  log,
  outro,
  selectWorktree,
  spinner,
} from "../prompts/interactive.js";

export const removeCommand = new Command("remove")
  .alias("rm")
  .description("Remove a worktree")
  .argument("[path-or-id]", "Worktree path, directory name, or # from `wtr ls`")
  .option("-f, --force", "Force removal even with uncommitted changes")
  .option("--delete-branch", "Also delete the associated branch")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (pathArg: string | undefined, options) => {
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

    let worktree: WorktreeInfo | undefined;
    if (!pathArg) {
      if (json) {
        printJsonError(
          "Worktree identifier required in --json mode",
          ErrorCode.IDENTIFIER_REQUIRED,
        );
        process.exit(1);
      }
      worktree = await selectWorktree(listResult.value);
    } else {
      worktree = findWorktree(listResult.value, pathArg);
      if (!worktree) {
        if (json)
          printJsonError(
            `Worktree not found: ${pathArg}`,
            ErrorCode.WORKTREE_NOT_FOUND,
          );
        console.error(formatError(`Worktree not found: ${pathArg}`));
        process.exit(1);
      }
    }

    if (worktree.isMain) {
      if (json)
        printJsonError(
          "Cannot remove the main worktree",
          ErrorCode.CANNOT_REMOVE_MAIN,
        );
      console.error(formatError("Cannot remove the main worktree"));
      process.exit(1);
    }

    // In JSON mode, skip confirmation (act as --yes)
    const skipConfirm = json || options.yes;

    if (!json) intro("wtr remove");

    if (!skipConfirm) {
      const message =
        options.deleteBranch && worktree.branch
          ? `Remove worktree at ${formatPath(worktree.path)} and delete branch ${formatBranch(worktree.branch)}?`
          : `Remove worktree at ${formatPath(worktree.path)}?`;

      const confirmed = await confirmDestructive(message, {
        initialValue: true,
        activeLabel: "Yes (recommended)",
      });
      if (!confirmed) {
        outro("Aborted");
        return;
      }
    }

    if (worktree.isLocked) {
      if (!json)
        console.log(
          formatWarning("Worktree is locked. Use --force to remove anyway."),
        );
      if (!options.force) {
        if (json)
          printJsonError(
            "Worktree is locked. Use --force to remove.",
            ErrorCode.WORKTREE_LOCKED,
          );
        process.exit(1);
      }
    }

    const s = json ? null : spinner();

    // Check for an associated database before removing the worktree directory
    const worktreeDbName = readWorktreeDb(worktree.path);
    let databaseDropped = false;

    if (worktreeDbName) {
      s?.start(`Dropping database ${pc.cyan(worktreeDbName)}`);
      const dbResult = dropDatabase(worktreeDbName);
      if (dbResult.ok) {
        s?.stop(pc.green(`Database ${worktreeDbName} dropped`));
        databaseDropped = true;
      } else {
        s?.stop(pc.yellow("Could not drop database"));
        if (!json) log.warning(dbResult.error.message);
      }
    }

    s?.start(`Removing worktree at ${formatPath(worktree.path)}`);

    const result = await removeWorktree({
      path: worktree.path,
      force: options.force ?? false,
    });

    if (!result.ok) {
      s?.stop(pc.red("Failed"));
      if (json) printJsonError(result.error.message);
      console.error(formatError(result.error.message));
      process.exit(1);
    }

    s?.stop(pc.green("Worktree removed"));

    let branchDeleted = false;

    if (options.deleteBranch && worktree.branch) {
      s?.start(`Deleting branch ${formatBranch(worktree.branch)}`);
      // Force-delete: user explicitly asked to delete the branch, and
      // git branch -d refuses to delete squash-merged branches
      const branchResult = await deleteBranch(worktree.branch, true);

      if (branchResult.ok) {
        s?.stop(pc.green("Branch deleted"));
        branchDeleted = true;
      } else {
        s?.stop(pc.yellow("Could not delete branch"));
        if (!json) log.warning(branchResult.error.message);
      }
    } else if (worktree.branch && !skipConfirm) {
      const defaultBranch = await getDefaultBranch();
      const isMerged = await isBranchMerged(worktree.branch, defaultBranch);
      const commitsAhead = await getCommitsAhead(
        worktree.branch,
        defaultBranch,
      );
      const isClean = isMerged || commitsAhead === 0;

      let activeLabel: string;
      if (isMerged) {
        activeLabel = "Yes (recommended, branch is merged)";
      } else if (commitsAhead === 0) {
        activeLabel = "Yes (recommended, no changes)";
      } else {
        activeLabel = "Yes (has unmerged changes)";
      }

      const shouldDelete = await confirmDestructive(
        `Delete branch ${formatBranch(worktree.branch)}?`,
        {
          initialValue: isClean,
          activeLabel,
        },
      );

      if (shouldDelete) {
        s?.start(`Deleting branch ${formatBranch(worktree.branch)}`);
        const branchResult = await deleteBranch(worktree.branch, !isClean);

        if (branchResult.ok) {
          s?.stop(pc.green("Branch deleted"));
          branchDeleted = true;
        } else {
          s?.stop(pc.yellow("Could not delete branch"));
          log.warning(branchResult.error.message);
        }
      }
    }

    if (json) {
      printJson({
        path: worktree.path,
        branch: worktree.branch,
        removed: true,
        branchDeleted,
        ...(worktreeDbName ? { databaseDropped, database: worktreeDbName } : {}),
      });
    } else {
      outro(`Removed worktree at ${formatPath(worktree.path)}`);
    }
  });
