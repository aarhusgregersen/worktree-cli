import { Command } from "commander";
import pc from "picocolors";
import { fail, runCliAction, unwrapCli } from "../cliRuntime.js";
import { ErrorCode } from "../core/errors.js";
import {
  createPr,
  getPrForBranch,
  isGhAvailable,
  pushBranch,
} from "../core/gh.js";
import { isBranchPushed } from "../core/status.js";
import { formatBranch, formatPath } from "../output/formatter.js";
import { textInput } from "../prompts/interactive.js";
import {
  requireGitRepository,
  requireWorktrees,
  resolveWorktreeTarget,
} from "./shared.js";

const titleFromBranch = (branch: string): string =>
  branch
    .replace(/^(feature|fix|chore|docs|refactor|test)\//, "")
    .replace(/[-_]/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());

export const createPrCommand = (): Command =>
  new Command("pr")
    .description("Create a pull request for a worktree")
    .argument(
      "[worktree]",
      "Worktree identifier (branch, path, or # from `wtr ls`)",
    )
    .option("--title <title>", "PR title")
    .option("--body <body>", "PR body")
    .option("--draft", "Create as draft PR")
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          if (!(await isGhAvailable())) {
            return fail(
              "GitHub CLI (gh) is not installed. Install it from https://cli.github.com",
              { code: ErrorCode.GH_NOT_AVAILABLE },
            );
          }
          const worktree = await resolveWorktreeTarget({
            worktrees: await requireWorktrees(),
            identifier,
            reporter,
          });
          if (!worktree.branch) {
            return fail("Cannot create PR for a detached worktree");
          }
          reporter.intro("wtr pr");

          const existing = await getPrForBranch(worktree.branch, worktree.path);
          if (existing) {
            return { existed: true, pushed: false, pr: existing };
          }

          const progress = reporter.spinner();
          let pushed = false;
          if (!(await isBranchPushed(worktree.branch, worktree.path))) {
            progress.start(`Pushing branch ${formatBranch(worktree.branch)}`);
            unwrapCli(await pushBranch(worktree.branch, worktree.path));
            progress.stop(pc.green("Branch pushed"));
            pushed = true;
          }

          const defaultTitle = titleFromBranch(worktree.branch);
          const title =
            options.title ??
            (reporter.interactive
              ? await textInput("PR title:", { defaultValue: defaultTitle })
              : defaultTitle);
          progress.start("Creating pull request");
          const pr = unwrapCli(
            await createPr({
              title,
              body: options.body,
              draft: options.draft ?? false,
              cwd: worktree.path,
            }),
          );
          progress.stop(pc.green("PR created"));
          return { existed: false, pushed, pr };
        },
        renderHuman: (result, reporter) => {
          reporter.info(
            result.existed
              ? `PR already exists: ${result.pr.url}`
              : `PR URL: ${formatPath(result.pr.url)}`,
          );
          reporter.outro(
            `${result.existed ? "PR" : "Created PR"} #${result.pr.number}: ${result.pr.title}`,
          );
        },
      });
    });
