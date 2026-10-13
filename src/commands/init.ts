import { Command } from "commander";
import pc from "picocolors";
import { runCliAction, unwrapCli } from "../cliRuntime.js";
import { addToGitignore, configExists, saveConfig } from "../config/loader.js";
import {
  CONFIG_FILENAME,
  DEFAULT_TERMINAL_CONFIG,
  type WtConfig,
} from "../config/schema.js";
import {
  hasClaudeInstructions,
  installClaudeInstructions,
} from "../core/claudeInstructions.js";
import { CliCancelled } from "../core/errors.js";
import { getSuggestions } from "../core/gitignore.js";
import { formatDim } from "../output/formatter.js";
import {
  confirm,
  note,
  numberInput,
  selectMultiple,
} from "../prompts/interactive.js";
import { requireGitRepository, requireRepoRoot } from "./shared.js";

export const createInitCommand = (): Command =>
  new Command("init")
    .description("Initialize wtr for this repository")
    .option("-y, --yes", "Use defaults without prompting")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const repoRoot = await requireRepoRoot();
          const useDefaults = !reporter.interactive || options.yes;
          reporter.intro("wtr init");

          if (
            configExists(repoRoot) &&
            !useDefaults &&
            !(await confirm("Overwrite existing configuration?", false))
          ) {
            reporter.outro("Initialization cancelled.");
            throw new CliCancelled();
          }

          const suggestions = getSuggestions(repoRoot);
          let copyFiles = suggestions
            .filter((suggestion) => suggestion.recommended)
            .map((suggestion) => suggestion.pattern);
          let portOffset = 100;
          let autoMode = false;

          if (!useDefaults) {
            if (suggestions.length > 0) {
              reporter.info(
                "Found files that might need to be copied to new worktrees:",
              );
              copyFiles = await selectMultiple(
                "Select files/directories to copy when creating worktrees:",
                suggestions.map((suggestion) => ({
                  value: suggestion.pattern,
                  label: suggestion.pattern,
                  hint: suggestion.reason,
                })),
                copyFiles,
              );
            } else {
              reporter.info(
                "No common config files found. You can add them manually later.",
              );
            }
            note(
              "Port offset determines how ports are adjusted in each worktree.\n" +
                "Worktree #2: PORT=3000 becomes PORT=3100.\n" +
                "External service ports are never changed.",
              "Port Configuration",
            );
            portOffset = await numberInput(
              "Port offset between worktrees:",
              100,
            );
            autoMode = await confirm(
              "Enable Claude auto mode in worktree terminals? (uses more tokens)",
              false,
            );
          }

          const config: WtConfig = {
            copyFiles,
            portOffset,
            portExclusions: [],
            db: false,
            terminal: { ...DEFAULT_TERMINAL_CONFIG, autoMode },
          };
          unwrapCli(saveConfig(repoRoot, config));
          reporter.success(`Created ${CONFIG_FILENAME}`);

          let gitignoreUpdated = false;
          if (
            useDefaults ||
            (await confirm(
              `Add ${CONFIG_FILENAME} to .gitignore? (recommended)`,
              true,
            ))
          ) {
            const ignored = addToGitignore(repoRoot, CONFIG_FILENAME);
            if (ignored.ok) {
              gitignoreUpdated = true;
              reporter.success(`Added ${CONFIG_FILENAME} to .gitignore`);
            } else reporter.warning(ignored.error.message);
          }

          let claudeMdUpdated = false;
          if (
            !hasClaudeInstructions() &&
            (useDefaults ||
              (await confirm(
                "Add wtr instructions to ~/.claude/CLAUDE.md for Claude Code? (recommended)",
                true,
              )))
          ) {
            const installed = installClaudeInstructions();
            if (installed.ok) {
              claudeMdUpdated = installed.value;
              if (installed.value) {
                reporter.success(
                  "Added wtr instructions to ~/.claude/CLAUDE.md",
                );
              }
            } else reporter.warning(installed.error.message);
          } else if (hasClaudeInstructions()) {
            reporter.info(
              formatDim(
                "wtr instructions already present in ~/.claude/CLAUDE.md",
              ),
            );
          }

          return {
            configPath: `${repoRoot}/${CONFIG_FILENAME}`,
            config,
            gitignoreUpdated,
            claudeMdUpdated,
          };
        },
        renderHuman: ({ config }, reporter) => {
          note(
            [
              `Files to copy: ${config.copyFiles.length > 0 ? config.copyFiles.join(", ") : "(none)"}`,
              `Port offset: ${config.portOffset}`,
            ].join("\n"),
            "Configuration",
          );
          reporter.outro(
            pc.green(
              "wtr initialized! Run `wtr add <branch>` to create a worktree.",
            ),
          );
        },
      });
    });
