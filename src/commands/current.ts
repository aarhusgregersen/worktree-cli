import { Command } from "commander";
import { fail, runCliAction, unwrapCli } from "../cliRuntime.js";
import { getCurrentBranch } from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { getMainWorktreePath } from "../core/git.js";
import { isInsideWorktree } from "../core/worktree.js";
import {
  formatBranch,
  formatDim,
  formatHead,
  formatPath,
} from "../output/formatter.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

interface CurrentResult {
  readonly path: string;
  readonly branch: string | undefined;
  readonly isMain: boolean;
  readonly head: string;
}

export const createCurrentCommand = (): Command =>
  new Command("current")
    .description("Show the current worktree")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      await runCliAction<CurrentResult>({
        json: options.json ?? false,
        action: async () => {
          requireGitRepository();
          const worktrees = await requireWorktrees();
          const cwd = process.cwd();
          const linked = isInsideWorktree(worktrees, cwd);
          if (linked) {
            return {
              path: linked.path,
              branch: linked.branch,
              isMain: false,
              head: linked.head,
            };
          }

          const mainPath = unwrapCli(await getMainWorktreePath());
          if (cwd === mainPath || cwd.startsWith(`${mainPath}/`)) {
            const main = worktrees.find((worktree) => worktree.isMain);
            const branchResult = await getCurrentBranch();
            return {
              path: mainPath,
              branch: branchResult.ok ? branchResult.value : main?.branch,
              isMain: true,
              head: main?.head ?? "",
            };
          }
          return fail("Not inside any worktree", {
            code: ErrorCode.NOT_INSIDE_WORKTREE,
          });
        },
        renderHuman: (current) =>
          console.log(
            `${formatBranch(current.branch ?? (current.isMain ? "unknown" : "detached"))} @ ${formatPath(current.path)} ${formatHead(current.head)}${current.isMain ? ` ${formatDim("(main worktree)")}` : ""}`,
          ),
      });
    });
