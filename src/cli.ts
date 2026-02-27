import { Command } from "commander";
import { addCommand } from "./commands/add.js";
import { cleanupCommand } from "./commands/cleanup.js";
import { diffCommand } from "./commands/diff.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { openCommand } from "./commands/open.js";
import { prCommand } from "./commands/pr.js";
import { pruneCommand } from "./commands/prune.js";
import { removeCommand } from "./commands/remove.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("wtr")
  .description("Git worktree manager with smart environment setup")
  .version("1.1.0")
  .option("--no-color", "Disable colored output");

program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(removeCommand);
program.addCommand(openCommand);
program.addCommand(pruneCommand);
program.addCommand(statusCommand);
program.addCommand(diffCommand);
program.addCommand(prCommand);
program.addCommand(cleanupCommand);

program.parseAsync(process.argv);
