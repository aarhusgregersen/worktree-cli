import Table from "cli-table3";
import { Command } from "commander";
import pc from "picocolors";
import { getCommitsAhead, getDefaultBranch } from "../core/branch.js";
import { getPrForBranch } from "../core/gh.js";
import { isGitRepository } from "../core/git.js";
import {
  getDiffStat,
  hasUncommittedChanges,
  isBranchPushed,
  isClaudeActive,
} from "../core/status.js";
import { listWorktrees } from "../core/worktree.js";
import { formatBranch, formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";

export const statusCommand = new Command("status")
  .alias("st")
  .description("Show enriched status of all worktrees")
  .option("--json", "Output as JSON")
  .option("-a, --all", "Include main worktree")
  .option("--no-pr", "Skip PR lookups")
  .action(async (options) => {
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

    const defaultBranch = await getDefaultBranch();
    const worktrees = options.all
      ? listResult.value
      : listResult.value.filter((wt) => !wt.isMain);

    const enriched = await Promise.all(
      worktrees.map(async (wt) => {
        if (wt.isMain || !wt.branch) {
          return {
            path: wt.path,
            branch: wt.branch,
            isMain: wt.isMain,
            head: wt.head,
            ahead: 0,
            diff: { filesChanged: 0, insertions: 0, deletions: 0 },
            dirty: false,
            untrackedCount: 0,
            pushed: false,
            pr: null as {
              number: number;
              title: string;
              url: string;
              state: string;
              isDraft: boolean;
            } | null,
            claude: false,
          };
        }

        const [ahead, diffResult, uncommittedResult, pushed, claude, pr] =
          await Promise.all([
            getCommitsAhead(wt.branch, defaultBranch),
            getDiffStat(wt.branch, defaultBranch),
            hasUncommittedChanges(wt.path),
            isBranchPushed(wt.branch),
            isClaudeActive(wt.path),
            options.pr !== false
              ? getPrForBranch(wt.branch)
              : Promise.resolve(null),
          ]);

        const diff = diffResult.ok
          ? diffResult.value
          : { filesChanged: 0, insertions: 0, deletions: 0 };
        const uncommitted = uncommittedResult.ok
          ? uncommittedResult.value
          : { dirty: false, untrackedCount: 0 };

        return {
          path: wt.path,
          branch: wt.branch,
          isMain: wt.isMain,
          head: wt.head,
          ahead,
          diff,
          dirty: uncommitted.dirty,
          untrackedCount: uncommitted.untrackedCount,
          pushed,
          pr,
          claude,
        };
      }),
    );

    if (json) {
      printJson(enriched);
      return;
    }

    if (enriched.length === 0) {
      console.log("No worktrees found.");
      return;
    }

    const table = new Table({
      head: [
        pc.bold("#"),
        pc.bold("Branch"),
        pc.bold("Ahead"),
        pc.bold("Changes"),
        pc.bold("Dirty"),
        pc.bold("Pushed"),
        pc.bold("PR"),
        pc.bold("Claude"),
      ],
      style: {
        head: [],
        border: ["dim"],
      },
    });

    for (const [i, wt] of enriched.entries()) {
      const changes =
        wt.diff.filesChanged > 0
          ? `+${wt.diff.insertions}/-${wt.diff.deletions}`
          : pc.dim("--");
      const prStr = wt.pr
        ? `#${wt.pr.number} ${wt.pr.state.toLowerCase()}`
        : pc.dim("--");
      const claudeStr = wt.claude ? pc.green("Active") : pc.dim("--");

      table.push([
        pc.dim(String(i + 1)),
        wt.branch ? formatBranch(wt.branch) : pc.dim("detached"),
        wt.ahead > 0 ? String(wt.ahead) : pc.dim("0"),
        changes,
        wt.dirty ? pc.yellow("Yes") : pc.dim("No"),
        wt.pushed ? pc.green("Yes") : pc.dim("No"),
        prStr,
        claudeStr,
      ]);
    }

    console.log(table.toString());
  });
