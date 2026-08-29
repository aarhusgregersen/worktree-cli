import { Command } from "commander";
import { fail, runCliAction, unwrapCli } from "../cliRuntime.js";
import { getDefaultBranch } from "../core/branch.js";
import { executeGitCommand } from "../core/git.js";
import {
  requireGitRepository,
  requireWorktrees,
  resolveWorktreeTarget,
} from "./shared.js";

interface ParsedStat {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly files: readonly string[];
}

interface DiffOutcome {
  readonly baseBranch: string;
  readonly branch: string | undefined;
  readonly path: string;
  readonly uncommitted?: true;
  readonly diff?: string;
  readonly stat?: ParsedStat;
  readonly raw: string;
}

export const createDiffCommand = (): Command =>
  new Command("diff")
    .description("Show diff for a worktree against its base branch")
    .argument(
      "[worktree]",
      "Worktree identifier (branch, path, or # from `wtr ls`)",
    )
    .option("--stat", "Show diffstat summary only")
    .option("--uncommitted", "Show uncommitted changes instead of branch diff")
    .option(
      "--base <branch>",
      "Base branch to diff against (default: auto-detected)",
    )
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, options) => {
      await runCliAction<DiffOutcome>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktree = await resolveWorktreeTarget({
            worktrees: await requireWorktrees(),
            identifier,
            reporter,
          });
          const uncommitted = options.uncommitted ?? false;
          if (!uncommitted && !worktree.branch) {
            return fail(
              "Cannot diff a detached worktree without --uncommitted",
            );
          }
          const baseBranch = uncommitted
            ? "HEAD"
            : (options.base ?? (await getDefaultBranch()));
          const args = uncommitted
            ? ["diff", "HEAD"]
            : ["diff", `origin/${baseBranch}...${worktree.branch}`];
          if (options.stat) args.push("--stat");
          const raw = unwrapCli(
            await executeGitCommand(args, { cwd: worktree.path }),
          ).stdout;
          return {
            baseBranch,
            branch: worktree.branch,
            path: worktree.path,
            ...(uncommitted ? { uncommitted: true as const } : {}),
            ...(options.stat ? { stat: parseStatOutput(raw) } : { diff: raw }),
            raw,
          };
        },
        renderJson: ({ raw: _, ...result }) => result,
        renderHuman: ({ raw }) => process.stdout.write(raw),
      });
    });

export const parseStatOutput = (output: string): ParsedStat => {
  const lines = output.trim().split("\n");
  const files = lines.slice(0, -1).flatMap((line) => {
    const match = line.match(/^\s*(.+?)\s+\|/);
    return match?.[1] ? [match[1].trim()] : [];
  });
  const summary = lines.at(-1) ?? "";
  return {
    filesChanged: Number.parseInt(
      summary.match(/(\d+) files? changed/)?.[1] ?? "0",
      10,
    ),
    insertions: Number.parseInt(
      summary.match(/(\d+) insertions?\(\+\)/)?.[1] ?? "0",
      10,
    ),
    deletions: Number.parseInt(
      summary.match(/(\d+) deletions?\(-\)/)?.[1] ?? "0",
      10,
    ),
    files,
  };
};
