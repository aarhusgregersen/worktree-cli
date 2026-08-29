import { Command } from "commander";
import { runCliAction } from "../cliRuntime.js";
import {
  type LaunchSpec,
  executeLaunchSpec,
  launchSpecJson,
  prepareLaunchSpec,
} from "../core/launch.js";
import { formatPath } from "../output/formatter.js";
import {
  requireConfig,
  requireGitRepository,
  requireRepoRoot,
  requireWorktrees,
  resolveWorktreeTarget,
} from "./shared.js";

export const createOpenCommand = (): Command =>
  new Command("open")
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
    .option(
      "--model <name>",
      "Model for the new Claude Code session (e.g. sonnet, opus, haiku)",
    )
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, options) => {
      await runCliAction<LaunchSpec>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktree = await resolveWorktreeTarget({
            worktrees: await requireWorktrees(),
            identifier,
            reporter,
          });
          const config = requireConfig(await requireRepoRoot());
          reporter.intro("wtr open");
          const spec = await prepareLaunchSpec({
            cwd: worktree.path,
            branch: worktree.branch,
            terminal: config.terminal,
            startClaude: Boolean(
              options.claude || options.plan || options.planFile,
            ),
            plan: options.plan,
            planFile: options.planFile,
            model: options.model,
          });
          if (spec.planPath) {
            reporter.info(`Plan written to ${formatPath(spec.planPath)}`);
          }
          if (reporter.interactive) executeLaunchSpec(spec);
          return spec;
        },
        renderJson: launchSpecJson,
        renderHuman: (spec, reporter) => {
          if (spec.handoff) {
            reporter.info(
              "HANDOFF: A new Claude Code session has been launched in the worktree.",
            );
            reporter.info(
              "Do NOT continue working on the delegated task in this session.",
            );
            reporter.outro(
              `Opened Claude Code in worktree at ${formatPath(spec.cwd)}`,
            );
          } else {
            reporter.outro(`Opened terminal at ${formatPath(spec.cwd)}`);
          }
        },
      });
    });
