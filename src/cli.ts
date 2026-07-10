import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { cdCommand } from "./commands/cd.js";
import { cleanCommand } from "./commands/clean.js";
import { completionsCommand } from "./commands/completions.js";
import { currentCommand } from "./commands/current.js";
import { dbCommand } from "./commands/db.js";
import { diffCommand } from "./commands/diff.js";
import { eachCommand } from "./commands/each.js";
import { execCommand } from "./commands/exec.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { openCommand } from "./commands/open.js";
import { prCommand } from "./commands/pr.js";
import { removeCommand } from "./commands/remove.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";
import { maybeShowWelcome, printGettingStarted } from "./output/welcome.js";

const program = new Command();

program
  .name("wtr")
  .description("Git worktree manager with smart environment setup")
  .version("1.2.0")
  .option("--no-color", "Disable colored output");

program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(removeCommand);
program.addCommand(openCommand);
program.addCommand(statusCommand);
program.addCommand(diffCommand);
program.addCommand(prCommand);
program.addCommand(cleanCommand);
program.addCommand(currentCommand);
program.addCommand(dbCommand);
program.addCommand(cdCommand);
program.addCommand(execCommand);
program.addCommand(eachCommand);
program.addCommand(syncCommand);
program.addCommand(completionsCommand);

const welcomed = maybeShowWelcome();

// Bare `wtr` with no subcommand: show the getting-started block, then help.
if (process.argv.length <= 2) {
  if (!welcomed) printGettingStarted();
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv);
