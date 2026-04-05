import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { ErrorCode } from "../core/errors.js";
import { getGitRoot, isGitRepository } from "../core/git.js";
import { resolvePlanText } from "../core/plan.js";
import {
  buildClaudeCommand,
  buildWorktreeEnv,
  openTerminalWindow,
  writePlanToTempFile,
} from "../core/terminal.js";
import {
  type WorktreeInfo,
  findWorktree,
  listWorktrees,
} from "../core/worktree.js";
import { formatError, formatPath } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import { intro, log, outro, selectWorktree } from "../prompts/interactive.js";

export const openCommand = new Command("open")
  .description("Open a worktree in a new terminal window")
  .argument(
    "[branch-or-path]",
    "Branch name, worktree path, directory name, or # from `wtr ls`",
  )
  .option("--claude", "Start Claude Code in the new terminal")
  .option(
    "--plan <text>",
    "Start Claude Code with a plan (implies --claude). Use '-' to read from stdin.",
  )
  .option(
    "--plan-file <path>",
    "Start Claude Code with a plan from a file (implies --claude)",
  )
  .option("--json", "Output as JSON")
  .action(async (identifier: string | undefined, options) => {
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

    const env = buildWorktreeEnv({
      path: worktree.path,
      branch: worktree.branch,
    });

    if (json) {
      // In JSON mode, do NOT actually open terminal — output what would run
      let command: string | undefined;

      if (options.plan || options.planFile) {
        const planText = await resolvePlanText(options);
        const planPath = writePlanToTempFile(planText);
        command = buildClaudeCommand({ planPath });
      } else if (options.claude) {
        command = buildClaudeCommand();
      }

      printJson({
        path: worktree.path,
        branch: worktree.branch,
        command: command ?? null,
        env,
        ...(command ? { handoff: true } : {}),
      });
      return;
    }

    intro("wtr open");

    const rootResult = await getGitRoot();
    const configResult = rootResult.ok ? loadConfig(rootResult.value) : undefined;
    const terminalMode = configResult?.ok
      ? configResult.value.terminal.mode
      : "window";
    const autoMode = configResult?.ok
      ? configResult.value.terminal.autoMode
      : true;

    let command: string | undefined;

    if (options.plan || options.planFile) {
      const planText = await resolvePlanText(options);
      const planPath = writePlanToTempFile(planText);
      command = buildClaudeCommand({ planPath, autoMode });
      log.info(`Plan written to ${formatPath(planPath)}`);
    } else if (options.claude) {
      command = buildClaudeCommand({ autoMode });
    }

    openTerminalWindow({ cwd: worktree.path, command, env, mode: terminalMode });

    if (command) {
      log.info(
        "HANDOFF: A new Claude Code session has been launched in the worktree.",
      );
      log.info(
        "Do NOT continue working on the delegated task in this session.",
      );
      outro(`Opened Claude Code in worktree at ${formatPath(worktree.path)}`);
    } else {
      outro(`Opened terminal at ${formatPath(worktree.path)}`);
    }
  });
