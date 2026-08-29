import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { createAddCommand } from "./commands/add.js";
import { createCdCommand } from "./commands/cd.js";
import { createCleanCommand } from "./commands/clean.js";
import { createCompletionsCommand } from "./commands/completions.js";
import { createCurrentCommand } from "./commands/current.js";
import { createDbCommand } from "./commands/db.js";
import { createDiffCommand } from "./commands/diff.js";
import { createEachCommand } from "./commands/each.js";
import { createExecCommand } from "./commands/exec.js";
import { createInitCommand } from "./commands/init.js";
import { createListCommand } from "./commands/list.js";
import { createOpenCommand } from "./commands/open.js";
import { createPrCommand } from "./commands/pr.js";
import { createRemoveCommand } from "./commands/remove.js";
import { createStatusCommand } from "./commands/status.js";
import { createSyncCommand } from "./commands/sync.js";

const commandFactories = [
  createInitCommand,
  createAddCommand,
  createListCommand,
  createRemoveCommand,
  createOpenCommand,
  createStatusCommand,
  createDiffCommand,
  createPrCommand,
  createCleanCommand,
  createCurrentCommand,
  createDbCommand,
  createCdCommand,
  createExecCommand,
  createEachCommand,
  createSyncCommand,
  createCompletionsCommand,
] as const;

export const createProgram = (): Command => {
  const program = new Command()
    .name("wtr")
    .description("Git worktree manager with smart environment setup")
    .version(packageJson.version)
    .option("--no-color", "Disable colored output");

  for (const createCommand of commandFactories) {
    program.addCommand(createCommand());
  }
  return program;
};
