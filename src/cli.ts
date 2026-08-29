import { maybeShowWelcome, printGettingStarted } from "./output/welcome.js";
import { createProgram } from "./program.js";

const program = createProgram();
const welcomed = maybeShowWelcome();

if (process.argv.length <= 2) {
  if (!welcomed) printGettingStarted();
  program.outputHelp();
} else {
  await program.parseAsync(process.argv);
}
