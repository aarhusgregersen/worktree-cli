import { Command } from "commander";
import pc from "picocolors";
import { fail, runCliAction } from "../cliRuntime.js";
import {
  fetchOrigin,
  getDefaultBranch,
  mergeFrom,
  rebaseOnto,
} from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { findWorktree, isInsideWorktree } from "../core/worktree.js";
import { formatBranch } from "../output/formatter.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

interface SyncResult {
  readonly defaultBranch: string;
  readonly strategy: "merge" | "rebase";
  readonly results: readonly {
    readonly path: string;
    readonly branch: string;
    readonly success: boolean;
    readonly error?: string;
  }[];
}

export const createSyncCommand = (): Command =>
  new Command("sync")
    .description("Sync worktree(s) with the default branch")
    .argument("[id]", "Worktree identifier (branch, path, or # from `wtr ls`)")
    .option("--merge", "Use merge instead of rebase")
    .option("--no-fetch", "Skip git fetch origin")
    .option("-a, --all", "Sync all non-main worktrees")
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, options) => {
      await runCliAction<SyncResult>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktrees = await requireWorktrees();
          const defaultBranch = await getDefaultBranch();
          const strategy = options.merge ? "merge" : "rebase";
          reporter.intro("wtr sync");
          const progress = reporter.spinner();

          if (options.fetch !== false) {
            progress.start("Fetching origin");
            const fetched = await fetchOrigin();
            if (!fetched.ok) {
              return fail(fetched.error.message, {
                code: ErrorCode.SYNC_FAILED,
                cause: fetched.error,
              });
            }
            progress.stop(pc.green("Fetched"));
          }

          const targets = options.all
            ? worktrees.flatMap((worktree) =>
                !worktree.isMain && worktree.branch
                  ? [{ path: worktree.path, branch: worktree.branch }]
                  : [],
              )
            : [
                (() => {
                  const worktree = identifier
                    ? findWorktree(worktrees, identifier)
                    : isInsideWorktree(worktrees, process.cwd());
                  if (!worktree) {
                    return fail(
                      identifier
                        ? `Worktree not found: ${identifier}`
                        : "Not inside a worktree. Specify an identifier or use --all.",
                      {
                        code: identifier
                          ? ErrorCode.WORKTREE_NOT_FOUND
                          : ErrorCode.NOT_INSIDE_WORKTREE,
                      },
                    );
                  }
                  if (!worktree.branch) {
                    return fail("Cannot sync a detached worktree", {
                      code: ErrorCode.SYNC_FAILED,
                    });
                  }
                  return { path: worktree.path, branch: worktree.branch };
                })(),
              ];

          const results: SyncResult["results"][number][] = [];
          for (const target of targets) {
            progress.start(
              `${strategy === "rebase" ? "Rebasing" : "Merging"} ${formatBranch(target.branch)} onto origin/${defaultBranch}`,
            );
            const synced =
              strategy === "rebase"
                ? await rebaseOnto(defaultBranch, target.path)
                : await mergeFrom(defaultBranch, target.path);
            if (synced.ok) {
              progress.stop(pc.green(`Synced ${formatBranch(target.branch)}`));
              results.push({ ...target, success: true });
            } else {
              progress.stop(
                pc.red(`Failed to sync ${formatBranch(target.branch)}`),
              );
              reporter.warning(synced.error.message);
              results.push({
                ...target,
                success: false,
                error: synced.error.message,
              });
            }
          }
          return { defaultBranch, strategy, results };
        },
        renderHuman: (result, reporter) => {
          const failed = result.results.filter((item) => !item.success).length;
          reporter.outro(
            failed > 0
              ? pc.yellow(`Sync complete with ${failed} failure(s)`)
              : pc.green(
                  `Synced ${result.results.length} worktree(s) via ${result.strategy} onto ${formatBranch(result.defaultBranch)}`,
                ),
          );
        },
        exitCode: ({ results }) =>
          results.some((result) => !result.success) ? 1 : 0,
      });
    });
