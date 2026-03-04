import { Command } from "commander";
import pc from "picocolors";
import { addToGitignore, configExists, saveConfig } from "../config/loader.js";
import { CONFIG_FILENAME, type WtConfig } from "../config/schema.js";
import { ErrorCode } from "../core/errors.js";
import { getGitRoot, isGitRepository } from "../core/git.js";
import { getSuggestions } from "../core/gitignore.js";
import { formatError } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import {
  confirm,
  intro,
  log,
  note,
  numberInput,
  outro,
  selectMultiple,
} from "../prompts/interactive.js";

export const initCommand = new Command("init")
  .description("Initialize wtr for this repository")
  .option("-y, --yes", "Use defaults without prompting")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const rootResult = await getGitRoot();
    if (!rootResult.ok) {
      if (json) printJsonError(rootResult.error.message);
      console.error(formatError(rootResult.error.message));
      process.exit(1);
    }
    const repoRoot = rootResult.value;

    // In JSON mode, act as --yes (use defaults)
    const useDefaults = json || options.yes;

    if (!json) intro("wtr init");

    if (configExists(repoRoot)) {
      if (!useDefaults) {
        log.warning(`${CONFIG_FILENAME} already exists in this repository.`);
        const overwrite = await confirm(
          "Overwrite existing configuration?",
          false,
        );
        if (!overwrite) {
          outro("Initialization cancelled.");
          return;
        }
      }
    }

    const suggestions = getSuggestions(repoRoot);
    let copyFiles: string[] = [];
    let portOffset = 100;

    if (useDefaults) {
      copyFiles = suggestions
        .filter((s) => s.recommended)
        .map((s) => s.pattern);
      portOffset = 100;
    } else {
      if (suggestions.length > 0) {
        log.info("Found files that might need to be copied to new worktrees:");

        copyFiles = await selectMultiple(
          "Select files/directories to copy when creating worktrees:",
          suggestions.map((s) => ({
            value: s.pattern,
            label: s.pattern,
            hint: s.reason,
          })),
          suggestions.filter((s) => s.recommended).map((s) => s.pattern),
        );
      } else {
        log.info(
          "No common config files found. You can add them manually later.",
        );
      }

      note(
        "Port offset determines how ports are adjusted in each worktree.\n" +
          "For example, with offset 100:\n" +
          "  - Worktree #2: PORT=3000 becomes PORT=3100\n" +
          "  - Worktree #3: PORT=3000 becomes PORT=3200\n\n" +
          "External service ports (database, redis, etc.) are never changed.",
        "Port Configuration",
      );

      portOffset = await numberInput(
        "Port offset between worktrees (recommended: 100):",
        100,
      );
    }

    const config: WtConfig = {
      copyFiles,
      portOffset,
      portExclusions: [],
    };

    const saveResult = saveConfig(repoRoot, config);
    if (!saveResult.ok) {
      if (json) printJsonError(saveResult.error.message);
      console.error(formatError(saveResult.error.message));
      process.exit(1);
    }

    let gitignoreUpdated = false;

    if (!json) log.success(`Created ${CONFIG_FILENAME}`);

    const shouldGitignore =
      useDefaults ||
      (await confirm(
        `Add ${CONFIG_FILENAME} to .gitignore? (recommended)`,
        true,
      ));

    if (shouldGitignore) {
      const ignoreResult = addToGitignore(repoRoot, CONFIG_FILENAME);
      if (ignoreResult.ok) {
        if (!json) log.success(`Added ${CONFIG_FILENAME} to .gitignore`);
        gitignoreUpdated = true;
      } else if (!json) {
        log.warning(
          `Could not update .gitignore: ${ignoreResult.error.message}`,
        );
      }
    }

    if (json) {
      printJson({
        configPath: `${repoRoot}/${CONFIG_FILENAME}`,
        config,
        gitignoreUpdated,
      });
    } else {
      const summary = [
        `Files to copy: ${copyFiles.length > 0 ? copyFiles.join(", ") : "(none)"}`,
        `Port offset: ${portOffset}`,
      ].join("\n");

      note(summary, "Configuration");

      outro(
        pc.green(
          "wtr initialized! Run `wtr add <branch>` to create a worktree.",
        ),
      );
    }
  });
