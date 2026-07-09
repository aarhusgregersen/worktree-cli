import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pc from "picocolors";
import { WELCOME_MARKER_PATH } from "../config/schema.js";

const gettingStarted = (): string => {
  const cmd = (s: string) => pc.cyan(s);
  return [
    "Get started:",
    "",
    `  ${cmd("wtr init")}                       set up this repo (config + Claude Code instructions)`,
    `  ${cmd('wtr add <branch> --plan "…"')}    create a worktree and delegate a task to Claude`,
    `  ${cmd("wtr add <branch> --open")}        create a worktree and open an interactive Claude session`,
    `  ${cmd("wtr --help")}                     see all commands`,
    "",
    pc.dim("Docs: https://github.com/aarhusgregersen/worktree-cli#readme"),
  ].join("\n");
};

// Getting-started block. Defaults to stdout for the interactive
// no-args case; the first-run banner routes it to stderr so it can't corrupt
// piped output (`wtr cd`, `wtr completions`, `--json`).
export const printGettingStarted = (
  stream: NodeJS.WriteStream = process.stdout,
): void => {
  stream.write(`\n${gettingStarted()}\n\n`);
};

// Show a one-time welcome on the very first invocation of any command.
// Returns true if the banner was shown. Never throws — a broken write must
// not take down the CLI.
export const maybeShowWelcome = (): boolean => {
  try {
    if (process.env.CI) return false;
    if (existsSync(WELCOME_MARKER_PATH)) return false;

    // Write the marker before printing so a failed write can't cause the
    // banner to repeat on every run — worst case the user misses it once.
    mkdirSync(dirname(WELCOME_MARKER_PATH), { recursive: true });
    writeFileSync(WELCOME_MARKER_PATH, `${new Date().toISOString()}\n`);

    process.stderr.write(`\n${pc.bold("Welcome to wtr!")}\n`);
    printGettingStarted(process.stderr);
    return true;
  } catch {
    return false;
  }
};
