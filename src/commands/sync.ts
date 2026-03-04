import { Command } from "commander";
import pc from "picocolors";
import {
  fetchOrigin,
  getDefaultBranch,
  mergeFrom,
  rebaseOnto,
} from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { isGitRepository } from "../core/git.js";
import {
  findWorktree,
  isInsideWorktree,
  listWorktrees,
} from "../core/worktree.js";
import { formatBranch, formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import { intro, log, outro, spinner } from "../prompts/interactive.js";

export const syncCommand = new Command("sync")
  .description("Sync worktree(s) with the default branch")
  .argument("[id]", "Worktree identifier (branch, path, or # from `wtr ls`)")
  .option("--merge", "Use merge instead of rebase")
  .option("--no-fetch", "Skip git fetch origin")
  .option("-a, --all", "Sync all non-main worktrees")
  .option("--json", "Output as JSON")
  .action(async (identifier: string | undefined, options) => {
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

    const defaultBranch = await getDefaultBranch();
    const strategy = options.merge ? "merge" : "rebase";

    if (!json) intro("wtr sync");

    const s = json ? null : spinner();

    // Fetch origin unless --no-fetch
    if (options.fetch !== false) {
      s?.start("Fetching origin");
      const fetchResult = await fetchOrigin();
      if (!fetchResult.ok) {
        s?.stop(pc.red("Failed"));
        if (json)
          printJsonError(fetchResult.error.message, ErrorCode.SYNC_FAILED);
        console.error(formatError(fetchResult.error.message));
        process.exit(1);
      }
      s?.stop(pc.green("Fetched"));
    }

    // Determine worktrees to sync
    let targets: { path: string; branch: string }[];

    if (options.all) {
      targets = listResult.value
        .filter((wt) => !wt.isMain && wt.branch)
        .map((wt) => ({ path: wt.path, branch: wt.branch as string }));
    } else if (identifier) {
      const wt = findWorktree(listResult.value, identifier);
      if (!wt) {
        if (json)
          printJsonError(
            `Worktree not found: ${identifier}`,
            ErrorCode.WORKTREE_NOT_FOUND,
          );
        console.error(formatError(`Worktree not found: ${identifier}`));
        process.exit(1);
      }
      if (!wt.branch) {
        if (json) printJsonError("Cannot sync a detached worktree");
        console.error(formatError("Cannot sync a detached worktree"));
        process.exit(1);
      }
      targets = [{ path: wt.path, branch: wt.branch }];
    } else {
      // Auto-detect from cwd
      const cwd = process.cwd();
      const current = isInsideWorktree(listResult.value, cwd);
      if (!current) {
        if (json)
          printJsonError(
            "Not inside a worktree. Specify an identifier or use --all.",
            ErrorCode.NOT_INSIDE_WORKTREE,
          );
        console.error(
          formatError(
            "Not inside a worktree. Specify an identifier or use --all.",
          ),
        );
        process.exit(1);
      }
      if (!current.branch) {
        if (json) printJsonError("Cannot sync a detached worktree");
        console.error(formatError("Cannot sync a detached worktree"));
        process.exit(1);
      }
      targets = [{ path: current.path, branch: current.branch }];
    }

    const results: {
      path: string;
      branch: string;
      success: boolean;
      error?: string;
    }[] = [];

    for (const target of targets) {
      s?.start(
        `${strategy === "rebase" ? "Rebasing" : "Merging"} ${formatBranch(target.branch)} onto origin/${defaultBranch}`,
      );

      const syncResult =
        strategy === "rebase"
          ? await rebaseOnto(defaultBranch, target.path)
          : await mergeFrom(defaultBranch, target.path);

      if (syncResult.ok) {
        s?.stop(pc.green(`Synced ${formatBranch(target.branch)}`));
        results.push({
          path: target.path,
          branch: target.branch,
          success: true,
        });
      } else {
        s?.stop(pc.red(`Failed to sync ${formatBranch(target.branch)}`));
        if (!json) log.warning(syncResult.error.message);
        results.push({
          path: target.path,
          branch: target.branch,
          success: false,
          error: syncResult.error.message,
        });
      }
    }

    if (json) {
      printJson({
        defaultBranch,
        strategy,
        results,
      });
      const anyFailed = results.some((r) => !r.success);
      if (anyFailed) process.exit(1);
    } else {
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        outro(pc.yellow(`Sync complete with ${failed.length} failure(s)`));
        process.exit(1);
      } else {
        outro(
          pc.green(
            `Synced ${results.length} worktree(s) via ${strategy} onto ${formatBranch(defaultBranch)}`,
          ),
        );
      }
    }
  });
