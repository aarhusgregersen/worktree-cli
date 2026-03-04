import { Command } from "commander";
import { getCurrentBranch } from "../core/branch.js";
import { ErrorCode } from "../core/errors.js";
import { getMainWorktreePath, isGitRepository } from "../core/git.js";
import { isInsideWorktree, listWorktrees } from "../core/worktree.js";
import {
  formatBranch,
  formatDim,
  formatError,
  formatHead,
  formatPath,
} from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";

export const currentCommand = new Command("current")
  .description("Show the current worktree")
  .option("--json", "Output as JSON")
  .action(async (options) => {
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

    const cwd = process.cwd();
    const worktree = isInsideWorktree(listResult.value, cwd);

    if (worktree) {
      if (json) {
        printJson({
          path: worktree.path,
          branch: worktree.branch,
          isMain: false,
          head: worktree.head,
        });
      } else {
        console.log(
          `${formatBranch(worktree.branch ?? "detached")} @ ${formatPath(worktree.path)} ${formatHead(worktree.head)}`,
        );
      }
      return;
    }

    // Check if we're in the main worktree
    const mainResult = await getMainWorktreePath();
    if (mainResult.ok) {
      const mainPath = mainResult.value;
      if (cwd === mainPath || cwd.startsWith(`${mainPath}/`)) {
        const mainWt = listResult.value.find((wt) => wt.isMain);
        const branchResult = await getCurrentBranch();
        const branch = branchResult.ok ? branchResult.value : mainWt?.branch;

        if (json) {
          printJson({
            path: mainPath,
            branch,
            isMain: true,
            head: mainWt?.head ?? "",
          });
        } else {
          console.log(
            `${formatBranch(branch ?? "unknown")} @ ${formatPath(mainPath)} ${formatHead(mainWt?.head ?? "")} ${formatDim("(main worktree)")}`,
          );
        }
        return;
      }
    }

    if (json)
      printJsonError("Not inside any worktree", ErrorCode.NOT_INSIDE_WORKTREE);
    console.error(formatError("Not inside any worktree"));
    process.exit(1);
  });
