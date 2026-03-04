import { Command } from "commander";
import pc from "picocolors";
import { ErrorCode } from "../core/errors.js";
import {
  createPr,
  getPrForBranch,
  isGhAvailable,
  pushBranch,
} from "../core/gh.js";
import { isGitRepository } from "../core/git.js";
import { isBranchPushed } from "../core/status.js";
import {
  type WorktreeInfo,
  findWorktree,
  listWorktrees,
} from "../core/worktree.js";
import { formatBranch, formatError, formatPath } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import {
  intro,
  log,
  outro,
  selectWorktree,
  spinner,
  textInput,
} from "../prompts/interactive.js";

export const prCommand = new Command("pr")
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
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const ghAvailable = await isGhAvailable();
    if (!ghAvailable) {
      const msg =
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com";
      if (json) printJsonError(msg, ErrorCode.GH_NOT_AVAILABLE);
      console.error(formatError(msg));
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
        printJsonError(
          "Worktree identifier required in --json mode",
          ErrorCode.IDENTIFIER_REQUIRED,
        );
        process.exit(1);
      }
      worktree = await selectWorktree(listResult.value);
    } else {
      worktree = findWorktree(listResult.value, identifier);
      if (!worktree) {
        if (json)
          printJsonError(
            `Worktree not found: ${identifier}`,
            ErrorCode.WORKTREE_NOT_FOUND,
          );
        console.error(formatError(`Worktree not found: ${identifier}`));
        process.exit(1);
      }
    }

    if (!worktree.branch) {
      if (json) printJsonError("Cannot create PR for a detached worktree");
      console.error(formatError("Cannot create PR for a detached worktree"));
      process.exit(1);
    }

    if (!json) intro("wtr pr");

    // Check if PR already exists
    const existingPr = await getPrForBranch(worktree.branch, worktree.path);
    if (existingPr) {
      if (json) {
        printJson({
          existed: true,
          pushed: false,
          pr: existingPr,
        });
      } else {
        log.info(`PR already exists: ${existingPr.url}`);
        outro(`PR #${existingPr.number}: ${existingPr.title}`);
      }
      return;
    }

    const s = json ? null : spinner();

    // Push if not pushed
    let pushed = false;
    const isPushed = await isBranchPushed(worktree.branch, worktree.path);
    if (!isPushed) {
      s?.start(`Pushing branch ${formatBranch(worktree.branch)}`);
      const pushResult = await pushBranch(worktree.branch, worktree.path);
      if (!pushResult.ok) {
        s?.stop(pc.red("Failed"));
        if (json) printJsonError(pushResult.error.message);
        console.error(formatError(pushResult.error.message));
        process.exit(1);
      }
      s?.stop(pc.green("Branch pushed"));
      pushed = true;
    }

    // Get title
    let title = options.title;
    if (!title) {
      if (json) {
        // Default to humanized branch name
        title = worktree.branch
          .replace(/^(feature|fix|chore|docs|refactor|test)\//, "")
          .replace(/[-_]/g, " ")
          .replace(/^\w/, (c) => c.toUpperCase());
      } else {
        const defaultTitle = worktree.branch
          .replace(/^(feature|fix|chore|docs|refactor|test)\//, "")
          .replace(/[-_]/g, " ")
          .replace(/^\w/, (c) => c.toUpperCase());

        title = await textInput("PR title:", {
          defaultValue: defaultTitle,
        });
      }
    }

    // Create PR
    s?.start("Creating pull request");
    const prResult = await createPr({
      title,
      body: options.body,
      draft: options.draft ?? false,
      cwd: worktree.path,
    });

    if (!prResult.ok) {
      s?.stop(pc.red("Failed"));
      if (json) printJsonError(prResult.error.message);
      console.error(formatError(prResult.error.message));
      process.exit(1);
    }

    s?.stop(pc.green("PR created"));

    if (json) {
      printJson({
        existed: false,
        pushed,
        pr: prResult.value,
      });
    } else {
      log.info(`PR URL: ${formatPath(prResult.value.url)}`);
      outro(`Created PR #${prResult.value.number}: ${prResult.value.title}`);
    }
  });
