import Table from "cli-table3";
import { Command } from "commander";
import pc from "picocolors";
import { runCliAction, unwrapCli } from "../cliRuntime.js";
import {
  getCommitsAhead,
  getDefaultBranch,
  getLastCommitDate,
} from "../core/branch.js";
import { type PrInfo, getPrForBranch } from "../core/gh.js";
import {
  type DiffStat,
  getClaudeCwds,
  getDiffStat,
  hasUncommittedChanges,
  isBranchPushed,
  isClaudeActive,
} from "../core/status.js";
import { formatBranch } from "../output/formatter.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

interface StatusItem {
  readonly path: string;
  readonly branch: string | undefined;
  readonly isMain: boolean;
  readonly head: string;
  readonly ahead: number;
  readonly diff: DiffStat;
  readonly dirty: boolean;
  readonly untrackedCount: number;
  readonly pushed: boolean;
  readonly pr: PrInfo | null;
  readonly claude: boolean;
  readonly lastCommit: string;
}

const EMPTY_DIFF: DiffStat = { filesChanged: 0, insertions: 0, deletions: 0 };

export const createStatusCommand = (): Command =>
  new Command("status")
    .alias("st")
    .description("Show enriched status of all worktrees")
    .option("--json", "Output as JSON")
    .option("-a, --all", "Include main worktree")
    .option("--no-pr", "Skip PR lookups")
    .action(async (options) => {
      await runCliAction<readonly StatusItem[]>({
        json: options.json ?? false,
        action: async () => {
          requireGitRepository();
          const all = await requireWorktrees();
          const worktrees = options.all
            ? all
            : all.filter((worktree) => !worktree.isMain);
          const [defaultBranch, claudeCwds] = await Promise.all([
            getDefaultBranch(),
            getClaudeCwds(),
          ]);
          return Promise.all(
            worktrees.map(async (worktree): Promise<StatusItem> => {
              if (worktree.isMain || !worktree.branch) {
                return {
                  path: worktree.path,
                  branch: worktree.branch,
                  isMain: worktree.isMain,
                  head: worktree.head,
                  ahead: 0,
                  diff: EMPTY_DIFF,
                  dirty: false,
                  untrackedCount: 0,
                  pushed: false,
                  pr: null,
                  claude: false,
                  lastCommit: "",
                };
              }
              const [ahead, diff, status, pushed, pr, lastCommit] =
                await Promise.all([
                  getCommitsAhead(worktree.branch, defaultBranch),
                  getDiffStat(worktree.branch, defaultBranch),
                  hasUncommittedChanges(worktree.path),
                  isBranchPushed(worktree.branch),
                  options.pr !== false
                    ? getPrForBranch(worktree.branch)
                    : Promise.resolve(null),
                  getLastCommitDate("%cr", worktree.path),
                ]);
              return {
                path: worktree.path,
                branch: worktree.branch,
                isMain: false,
                head: worktree.head,
                ahead,
                diff: unwrapCli(diff),
                dirty: unwrapCli(status).dirty,
                untrackedCount: unwrapCli(status).untrackedCount,
                pushed,
                pr,
                claude: isClaudeActive(claudeCwds, worktree.path),
                lastCommit,
              };
            }),
          );
        },
        renderHuman: (items) => {
          if (items.length === 0) {
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
              pc.bold("Activity"),
            ],
            style: { head: [], border: ["dim"] },
          });
          items.forEach((item, index) => {
            table.push([
              pc.dim(String(index + 1)),
              item.branch ? formatBranch(item.branch) : pc.dim("detached"),
              item.ahead > 0 ? String(item.ahead) : pc.dim("0"),
              item.diff.filesChanged > 0
                ? `+${item.diff.insertions}/-${item.diff.deletions}`
                : pc.dim("--"),
              item.dirty ? pc.yellow("Yes") : pc.dim("No"),
              item.pushed ? pc.green("Yes") : pc.dim("No"),
              item.pr
                ? `#${item.pr.number} ${item.pr.state.toLowerCase()}`
                : pc.dim("--"),
              item.claude ? pc.green("Active") : pc.dim("--"),
              item.lastCommit || pc.dim("--"),
            ]);
          });
          console.log(table.toString());
        },
      });
    });
