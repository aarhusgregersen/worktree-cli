import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { addToGitignore, configExists, saveConfig } from "../config/loader.js";
import {
  CONFIG_FILENAME,
  DEFAULT_TERMINAL_CONFIG,
  type WtConfig,
} from "../config/schema.js";
import { ErrorCode } from "../core/errors.js";
import { getGitRoot, isGitRepository } from "../core/git.js";
import { getSuggestions } from "../core/gitignore.js";
import { formatDim, formatError } from "../output/formatter.js";
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

const CLAUDE_MD_SNIPPET = `## wtr (worktree-cli)
Use \`wtr\` to manage git worktrees for parallel development. Prefer this over
raw \`git worktree\` commands. Key commands:
- \`wtr add <branch> --plan "..."\` — create worktree and delegate task to Claude (preferred)
- \`wtr add <branch> --open\` — create worktree and open terminal with interactive Claude
- \`wtr add <branch>\` — create worktree only, no terminal (rarely needed)
- \`wtr add <branch> --db\` — clone the **local** PostgreSQL database (not prod) into the worktree for isolated migrations

New branches are always based on \`origin/<default-branch>\` (main/master), never the
current branch — fetched first so the worktree starts from clean, up-to-date main.
Override with \`--base <ref>\`.

- \`wtr list\` — list worktrees
- \`wtr status\` — enriched status with branch/commit/PR info
- \`wtr remove <id>\` — remove a worktree (interactive: prompts to confirm, then to delete the branch)
- \`wtr remove <id> -y\` — skip prompts; use in scripts, \`/loop\`, or headless runs where no tty can answer. Add \`--delete-branch\` only when the branch is merged and you intend to clean it up
- \`wtr pr <id>\` — create a GitHub PR for a worktree
All commands support \`--json\` for structured output.

When creating a worktree, almost always use \`--plan\` (if you have instructions to
delegate) or \`--open\` (if interactive exploration is needed). Using bare \`wtr add\`
without either flag is rare — only do it when the user explicitly doesn't want a
terminal opened. After \`--plan\` or \`--open\`, hand off and do NOT continue the
delegated task in the current session.

Both \`--plan\` and \`--open\` accept \`--model <name>\` to pick which model the
delegated session runs on. Judge the task before delegating: mechanical or
narrowly-scoped work (rename, small fix, boilerplate) → a cheaper/faster model
(e.g. \`haiku\`); hard architectural, ambiguous, or high-stakes work → a stronger
model (e.g. \`opus\`); everything in between → omit the flag and let it default.
Don't default to the strongest model out of caution — match the model to the task.`;

const CLAUDE_MD_MARKER = "## wtr (worktree-cli)";

function claudeMdContainsWtr(content: string): boolean {
  return content.includes(CLAUDE_MD_MARKER);
}

function addWtrToClaudeMd(): { added: boolean; path: string; error?: string } {
  const claudeDir = join(homedir(), ".claude");
  const claudeMdPath = join(claudeDir, "CLAUDE.md");

  try {
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    if (existsSync(claudeMdPath)) {
      const content = readFileSync(claudeMdPath, "utf-8");
      if (claudeMdContainsWtr(content)) {
        return { added: false, path: claudeMdPath };
      }
      const separator = content.endsWith("\n") ? "\n" : "\n\n";
      appendFileSync(claudeMdPath, `${separator}${CLAUDE_MD_SNIPPET}\n`);
    } else {
      appendFileSync(claudeMdPath, `${CLAUDE_MD_SNIPPET}\n`);
    }

    return { added: true, path: claudeMdPath };
  } catch (e) {
    return {
      added: false,
      path: claudeMdPath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

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
    let autoMode = false;

    if (useDefaults) {
      copyFiles = suggestions
        .filter((s) => s.recommended)
        .map((s) => s.pattern);
      portOffset = 100;
      autoMode = false;
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

      autoMode = await confirm(
        "Enable Claude auto mode in worktree terminals? (uses more tokens)",
        false,
      );
    }

    const config: WtConfig = {
      copyFiles,
      portOffset,
      portExclusions: [],
      terminal: { ...DEFAULT_TERMINAL_CONFIG, autoMode },
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

    let claudeMdUpdated = false;

    const claudeMdPath = join(homedir(), ".claude", "CLAUDE.md");
    const claudeMdExists = existsSync(claudeMdPath);
    const alreadyHasWtr =
      claudeMdExists &&
      claudeMdContainsWtr(readFileSync(claudeMdPath, "utf-8"));

    if (!alreadyHasWtr) {
      const shouldAddClaudeMd =
        useDefaults ||
        (await confirm(
          "Add wtr instructions to ~/.claude/CLAUDE.md for Claude Code? (recommended)",
          true,
        ));

      if (shouldAddClaudeMd) {
        const result = addWtrToClaudeMd();
        if (result.added) {
          if (!json) log.success("Added wtr instructions to ~/.claude/CLAUDE.md");
          claudeMdUpdated = true;
        } else if (result.error) {
          if (!json)
            log.warning(
              `Could not update ~/.claude/CLAUDE.md: ${result.error}`,
            );
        }
      }
    } else if (!json) {
      log.info(
        formatDim("wtr instructions already present in ~/.claude/CLAUDE.md"),
      );
    }

    if (json) {
      printJson({
        configPath: `${repoRoot}/${CONFIG_FILENAME}`,
        config,
        gitignoreUpdated,
        claudeMdUpdated,
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
