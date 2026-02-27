import { Command } from "commander";
import { getDefaultBranch } from "../core/branch.js";
import { executeGitCommand, isGitRepository } from "../core/git.js";
import {
  type WorktreeInfo,
  findWorktree,
  listWorktrees,
} from "../core/worktree.js";
import { formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import { selectWorktree } from "../prompts/interactive.js";

export const diffCommand = new Command("diff")
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
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json) printJsonError("Not a git repository");
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
    if (!identifier) {
      if (json) {
        printJsonError("Worktree identifier required in --json mode");
        process.exit(1);
      }
      worktree = await selectWorktree(listResult.value);
    } else {
      worktree = findWorktree(listResult.value, identifier);
      if (!worktree) {
        if (json) printJsonError(`Worktree not found: ${identifier}`);
        console.error(formatError(`Worktree not found: ${identifier}`));
        process.exit(1);
      }
    }

    const baseBranch = options.base ?? (await getDefaultBranch());

    if (options.uncommitted) {
      // Show working tree changes within the worktree
      const args = ["diff", "HEAD"];
      if (options.stat) args.push("--stat");

      const result = await executeGitCommand(args, { cwd: worktree.path });
      if (!result.ok) {
        if (json) printJsonError(result.error.message);
        console.error(formatError(result.error.message));
        process.exit(1);
      }

      if (json) {
        if (options.stat) {
          const stat = parseStatOutput(result.value.stdout);
          printJson({
            baseBranch: "HEAD",
            branch: worktree.branch,
            path: worktree.path,
            uncommitted: true,
            stat,
          });
        } else {
          printJson({
            baseBranch: "HEAD",
            branch: worktree.branch,
            path: worktree.path,
            uncommitted: true,
            diff: result.value.stdout,
          });
        }
      } else {
        process.stdout.write(result.value.stdout);
      }
      return;
    }

    // Committed changes vs base branch
    if (!worktree.branch) {
      if (json)
        printJsonError("Cannot diff a detached worktree without --uncommitted");
      console.error(
        formatError("Cannot diff a detached worktree without --uncommitted"),
      );
      process.exit(1);
    }

    const args = ["diff", `origin/${baseBranch}...${worktree.branch}`];
    if (options.stat) args.push("--stat");

    const result = await executeGitCommand(args, { cwd: worktree.path });
    if (!result.ok) {
      if (json) printJsonError(result.error.message);
      console.error(formatError(result.error.message));
      process.exit(1);
    }

    if (json) {
      if (options.stat) {
        const stat = parseStatOutput(result.value.stdout);
        printJson({
          baseBranch,
          branch: worktree.branch,
          path: worktree.path,
          stat,
        });
      } else {
        printJson({
          baseBranch,
          branch: worktree.branch,
          path: worktree.path,
          diff: result.value.stdout,
        });
      }
    } else {
      process.stdout.write(result.value.stdout);
    }
  });

const parseStatOutput = (
  output: string,
): {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
} => {
  const lines = output.trim().split("\n");
  const files: string[] = [];

  // All lines except the last summary line are file entries
  for (const line of lines.slice(0, -1)) {
    const match = line.match(/^\s*(.+?)\s+\|/);
    if (match?.[1]) files.push(match[1].trim());
  }

  // Parse summary line: " 3 files changed, 10 insertions(+), 5 deletions(-)"
  const summaryLine = lines[lines.length - 1] ?? "";
  const filesChanged = Number.parseInt(
    summaryLine.match(/(\d+) files? changed/)?.[1] ?? "0",
    10,
  );
  const insertions = Number.parseInt(
    summaryLine.match(/(\d+) insertions?\(\+\)/)?.[1] ?? "0",
    10,
  );
  const deletions = Number.parseInt(
    summaryLine.match(/(\d+) deletions?\(-\)/)?.[1] ?? "0",
    10,
  );

  return { filesChanged, insertions, deletions, files };
};
