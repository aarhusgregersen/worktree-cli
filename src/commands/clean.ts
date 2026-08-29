import Table from "cli-table3";
import { Command } from "commander";
import pc from "picocolors";
import { runCliAction, unwrapCli } from "../cliRuntime.js";
import {
  deleteBranch,
  fetchOrigin,
  getDefaultBranch,
  isBranchMerged,
} from "../core/branch.js";
import { CliCancelled } from "../core/errors.js";
import { getPrForBranch } from "../core/gh.js";
import { removeManagedWorktrees } from "../core/lifecycle.js";
import { hasUncommittedChanges } from "../core/status.js";
import { pruneWorktrees } from "../core/worktree.js";
import { formatBranch } from "../output/formatter.js";
import { confirmDestructive } from "../prompts/interactive.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

interface MergedCandidate {
  readonly path: string;
  readonly branch: string;
  readonly reason: string;
  readonly dirty: boolean;
  readonly worktree: Awaited<ReturnType<typeof requireWorktrees>>[number];
}

interface CleanResult {
  readonly pruned: readonly string[];
  readonly candidates: readonly Omit<MergedCandidate, "worktree">[];
  readonly removed: readonly {
    readonly path: string;
    readonly branch: string;
    readonly branchDeleted: boolean;
    readonly database?: string;
    readonly databaseDropped?: boolean;
    readonly orphanedDatabase?: string;
  }[];
  readonly skipped: readonly {
    readonly path: string;
    readonly branch: string;
    readonly reason: string;
  }[];
  readonly failed: readonly {
    readonly phase: "prune" | "remove";
    readonly path?: string;
    readonly branch?: string;
    readonly error: string;
    readonly code?: string;
    readonly database?: unknown;
  }[];
  readonly dryRun: boolean;
}

export const createCleanCommand = (): Command =>
  new Command("clean")
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
      "Force removal even if dirty or database cleanup fails",
    )
    .option("--dry-run", "Show what would be cleaned without doing it")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      await runCliAction<CleanResult>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          reporter.intro("wtr clean");
          const progress = reporter.spinner();
          const both = !options.dangling && !options.merged;
          const doDangling = options.dangling || both;
          const doMerged = options.merged || both;

          let staleEntries: readonly string[] = [];
          if (doDangling) {
            progress.start("Checking for stale worktrees");
            staleEntries = unwrapCli(await pruneWorktrees(true));
            progress.stop("Checked");
          }

          let candidates: readonly MergedCandidate[] = [];
          if (doMerged) {
            progress.start("Fetching latest from origin");
            const fetched = await fetchOrigin();
            if (!fetched.ok) reporter.warning(fetched.error.message);
            progress.stop(
              fetched.ok ? "Fetched" : "Fetch failed; using local state",
            );

            progress.start("Checking worktrees");
            const defaultBranch = await getDefaultBranch();
            const nonMain = (await requireWorktrees()).filter(
              (worktree) => !worktree.isMain && worktree.branch,
            );
            const found = await Promise.all(
              nonMain.map(async (worktree): Promise<MergedCandidate | null> => {
                const branch = worktree.branch;
                if (!branch) return null;
                const [merged, pr, status] = await Promise.all([
                  isBranchMerged(branch, defaultBranch),
                  getPrForBranch(branch, worktree.path),
                  hasUncommittedChanges(worktree.path),
                ]);
                if (!status.ok) {
                  reporter.warning(
                    `Could not inspect ${worktree.path}; treating it as dirty: ${status.error.message}`,
                  );
                }
                const prMerged = pr?.state === "MERGED";
                if (!merged && !prMerged) return null;
                return {
                  path: worktree.path,
                  branch,
                  reason: prMerged ? "PR merged" : "branch merged",
                  dirty: status.ok ? status.value.dirty : true,
                  worktree,
                };
              }),
            );
            candidates = found.filter(
              (candidate): candidate is MergedCandidate => candidate !== null,
            );
            progress.stop("Checked");
          }

          const removable = candidates.filter(
            (candidate) => !candidate.dirty || options.force,
          );
          const skipped = options.force
            ? []
            : candidates
                .filter((candidate) => candidate.dirty)
                .map((candidate) => ({
                  path: candidate.path,
                  branch: candidate.branch,
                  reason: "uncommitted changes",
                }));

          if (
            reporter.interactive &&
            !options.dryRun &&
            !options.yes &&
            (staleEntries.length > 0 || removable.length > 0)
          ) {
            const confirmed = await confirmDestructive(
              `Clean up ${staleEntries.length} stale entr(y/ies) and ${removable.length} worktree(s)?`,
            );
            if (!confirmed) {
              reporter.outro("Aborted");
              throw new CliCancelled();
            }
          }

          const candidateJson = candidates.map(
            ({ worktree: _, ...candidate }) => candidate,
          );
          if (options.dryRun) {
            return {
              pruned: staleEntries,
              candidates: candidateJson,
              removed: [],
              skipped,
              failed: [],
              dryRun: true,
            };
          }

          let pruned: readonly string[] = [];
          const failed: CleanResult["failed"][number][] = [];
          if (staleEntries.length > 0) {
            const result = await pruneWorktrees(false);
            if (result.ok) pruned = staleEntries;
            else {
              reporter.warning(result.error.message);
              failed.push({ phase: "prune", error: result.error.message });
            }
          }

          const removed: CleanResult["removed"][number][] = [];
          if (removable.length > 0) {
            progress.start(`Removing ${removable.length} worktree(s)`);
          }
          const removalResults = await removeManagedWorktrees(
            removable.map((candidate) => candidate.worktree),
            options.force ?? false,
          );
          for (const result of removalResults) {
            const candidate = removable.find(
              (item) => item.path === result.worktree.path,
            );
            if (!candidate) continue;
            if (!result.ok) {
              reporter.warning(result.error.message);
              failed.push({
                phase: "remove",
                path: candidate.path,
                branch: candidate.branch,
                error: result.error.message,
                ...(result.error.code ? { code: result.error.code } : {}),
                ...(result.error.details?.database
                  ? { database: result.error.details.database }
                  : {}),
              });
              continue;
            }

            let branchDeleted = false;
            if (options.deleteBranches) {
              const deleted = await deleteBranch(candidate.branch, true);
              branchDeleted = deleted.ok;
              if (!deleted.ok) reporter.warning(deleted.error.message);
            }
            removed.push({
              path: result.value.path,
              branch: candidate.branch,
              branchDeleted,
              ...(result.value.database
                ? {
                    database: result.value.database,
                    databaseDropped: result.value.databaseDropped,
                  }
                : {}),
              ...(result.value.orphanedDatabase
                ? { orphanedDatabase: result.value.orphanedDatabase }
                : {}),
            });
          }
          if (removable.length > 0) {
            progress.stop(
              failed.some((failure) => failure.phase === "remove")
                ? pc.yellow("Removal completed with failures")
                : pc.green("Removed"),
            );
          }

          return {
            pruned,
            candidates: candidateJson,
            removed,
            skipped,
            failed,
            dryRun: false,
          };
        },
        renderJson: ({ dryRun: _, ...result }) => result,
        renderHuman: (result, reporter) => {
          if (result.candidates.length > 0) {
            const table = new Table({
              head: [
                pc.bold("#"),
                pc.bold("Branch"),
                pc.bold("Reason"),
                pc.bold("Dirty"),
              ],
              style: { head: [], border: ["dim"] },
            });
            result.candidates.forEach((candidate, index) =>
              table.push([
                pc.dim(String(index + 1)),
                formatBranch(candidate.branch),
                candidate.reason,
                candidate.dirty ? pc.yellow("Yes") : pc.dim("No"),
              ]),
            );
            console.log(table.toString());
          }
          if (result.skipped.length > 0) {
            reporter.warning(
              `${result.skipped.length} worktree(s) were skipped because they have uncommitted changes.`,
            );
          }
          if (result.dryRun) reporter.outro("Dry run complete");
          else {
            reporter.outro(
              `Cleaned up: pruned ${result.pruned.length}, removed ${result.removed.length}, failed ${result.failed.length}`,
            );
          }
        },
        exitCode: ({ failed }) => (failed.length > 0 ? 1 : 0),
      });
    });
