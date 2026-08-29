import { Command } from "commander";
import { runCliAction } from "../cliRuntime.js";
import {
  requireGitRepository,
  requireWorktrees,
  resolveWorktreeTarget,
} from "./shared.js";

export const createCdCommand = (): Command =>
  new Command("cd")
    .description("Print the path of a worktree (for use with cd)")
    .argument("<id>", "Worktree identifier (branch, path, or # from `wtr ls`)")
    .option("--json", "Output as JSON")
    .action(async (identifier: string, options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktree = await resolveWorktreeTarget({
            worktrees: await requireWorktrees(),
            identifier,
            reporter,
          });
          return { path: worktree.path, branch: worktree.branch };
        },
        renderHuman: ({ path }) => process.stdout.write(`${path}\n`),
      });
    });
