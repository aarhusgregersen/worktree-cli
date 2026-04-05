import { dirname, resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import {
  configExists,
  globalConfigExists,
  loadConfig,
} from "../config/loader.js";
import { branchExists, fetchOrigin, getDefaultBranch } from "../core/branch.js";
import {
  createDatabase,
  deriveDbName,
  findDatabaseUrl,
  parseDatabaseName,
  updateDatabaseUrlInEnvFiles,
  writeWorktreeDb,
} from "../core/database.js";
import { bumpPortsInEnvFiles, copyFiles } from "../core/env.js";
import { ErrorCode } from "../core/errors.js";
import {
  getGitRoot,
  getMainWorktreePath,
  isGitRepository,
} from "../core/git.js";
import { resolvePlanText } from "../core/plan.js";
import {
  buildClaudeCommand,
  buildWorktreeEnv,
  openTerminalWindow,
  writePlanToTempFile,
} from "../core/terminal.js";
import {
  addWorktree,
  isInsideWorktree,
  listWorktrees,
} from "../core/worktree.js";
import {
  formatBranch,
  formatDim,
  formatError,
  formatPath,
} from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import { intro, log, outro, spinner } from "../prompts/interactive.js";

export const addCommand = new Command("add")
  .description("Create a new worktree")
  .argument("<branch>", "Branch name (existing or new)")
  .argument("[path]", "Worktree path (optional)")
  .option("-b, --create", "Create new branch if it does not exist")
  .option("-B, --force-create", "Create or reset branch")
  .option("--base <ref>", "Base ref for new branch (default: origin/<default-branch>)")
  .option("--detach", "Create in detached HEAD state")
  .option("--no-copy", "Skip copying files from main worktree")
  .option("--no-bump", "Skip port bumping")
  .option(
    "--db [name]",
    "Clone the PostgreSQL database for this worktree (name defaults to <template>_wtr_<branch>)",
  )
  .option("--open", "Open a new terminal window with Claude Code")
  .option(
    "--plan <text>",
    "Open terminal with Claude Code and a plan (implies --open). Use '-' to read from stdin.",
  )
  .option(
    "--plan-file <path>",
    "Open terminal with Claude Code and a plan from a file (implies --open)",
  )
  .option("--json", "Output as JSON")
  .action(async (branch: string, pathArg: string | undefined, options) => {
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

    const mainWorktreeResult = await getMainWorktreePath();
    if (!mainWorktreeResult.ok) {
      if (json) printJsonError(mainWorktreeResult.error.message);
      console.error(formatError(mainWorktreeResult.error.message));
      process.exit(1);
    }
    const mainWorktreePath = mainWorktreeResult.value;

    // Guard: prevent creating worktrees inside non-main worktrees
    const listResult = await listWorktrees();
    if (listResult.ok) {
      const enclosing = isInsideWorktree(listResult.value, process.cwd());
      if (enclosing) {
        const msg = `Cannot create a worktree inside another worktree (${enclosing.path}). Run this command from the main worktree instead.`;
        if (json) printJsonError(msg, ErrorCode.INSIDE_WORKTREE);
        console.error(formatError(msg));
        process.exit(1);
      }
    }

    const safeBranchName = branch.replace(/\//g, "-");
    const worktreePath = pathArg
      ? resolve(pathArg)
      : resolve(dirname(repoRoot), safeBranchName);

    const exists = await branchExists(branch);
    const shouldCreateBranch = !exists && !options.detach;

    if (!json) intro("wtr add");

    const s = json ? null : spinner();

    // When creating a new branch, fetch origin and default base to origin/<default-branch>
    // so the worktree always starts from a clean, up-to-date main branch
    let baseRef: string | undefined = options.base;
    if (!baseRef && shouldCreateBranch) {
      s?.start("Fetching origin");
      const fetchResult = await fetchOrigin();
      if (!fetchResult.ok) {
        s?.stop(pc.yellow("Fetch failed (continuing with local state)"));
      } else {
        s?.stop(pc.green("Fetched origin"));
      }

      const defaultBranch = await getDefaultBranch();
      baseRef = `origin/${defaultBranch}`;
    }

    s?.start(`Creating worktree at ${formatPath(worktreePath)}`);

    const result = await addWorktree({
      path: worktreePath,
      branch,
      createBranch: (options.create ?? false) || shouldCreateBranch,
      forceCreate: options.forceCreate ?? false,
      baseRef,
      detach: options.detach ?? false,
    });

    if (!result.ok) {
      s?.stop(pc.red("Failed"));
      if (json) printJsonError(result.error.message);
      console.error(formatError(result.error.message));
      process.exit(1);
    }

    s?.stop(pc.green("Worktree created"));

    if (
      !json &&
      shouldCreateBranch &&
      !options.create &&
      !options.forceCreate
    ) {
      log.info(`Branch '${branch}' did not exist and was created`);
    }

    const jsonResult: Record<string, unknown> = {
      path: worktreePath,
      branch,
      branchCreated: shouldCreateBranch,
      filesCopied: [] as string[],
      portsBumped: [] as {
        file: string;
        changes: { key: string; oldPort: number; newPort: number }[];
      }[],
      portOffset: 0,
    };

    if (configExists(repoRoot) || globalConfigExists()) {
      const configResult = loadConfig(repoRoot);
      if (!configResult.ok) {
        if (!json)
          log.warning(`Could not load config: ${configResult.error.message}`);
      } else {
        const config = configResult.value;

        if (options.copy !== false && config.copyFiles.length > 0) {
          s?.start("Copying configuration files");
          const copyResult = copyFiles(
            mainWorktreePath,
            worktreePath,
            config.copyFiles,
          );

          if (!copyResult.ok) {
            s?.stop(pc.yellow("Copy failed"));
            if (!json) log.warning(copyResult.error.message);
          } else if (copyResult.value.length > 0) {
            s?.stop(pc.green("Files copied"));
            if (!json) log.info(`Copied: ${copyResult.value.join(", ")}`);
            jsonResult.filesCopied = copyResult.value;
          } else {
            s?.stop(formatDim("No files to copy"));
          }
        }

        if (options.bump !== false && config.portOffset > 0) {
          const freshList = await listWorktrees();
          if (!freshList.ok) {
            if (!json)
              log.warning(
                "Could not determine worktree index for port bumping",
              );
          } else {
            const worktreeIndex = freshList.value.length - 1;
            if (worktreeIndex > 0) {
              const offset = config.portOffset * worktreeIndex;
              jsonResult.portOffset = offset;

              s?.start(`Bumping ports by +${offset}`);
              const bumpResult = bumpPortsInEnvFiles(
                worktreePath,
                offset,
                config.portExclusions,
              );

              if (!bumpResult.ok) {
                s?.stop(pc.yellow("Port bump failed"));
                if (!json) log.warning(bumpResult.error.message);
              } else if (bumpResult.value.length > 0) {
                s?.stop(pc.green("Ports updated"));
                jsonResult.portsBumped = bumpResult.value;
                if (!json) {
                  for (const r of bumpResult.value) {
                    const changes = r.changes
                      .map((c) => `${c.key}: ${c.oldPort} -> ${c.newPort}`)
                      .join(", ");
                    log.info(`${r.file}: ${changes}`);
                  }
                }
              } else {
                s?.stop(formatDim("No ports to bump"));
              }
            }
          }
        }
      }
    } else if (!json) {
      log.info(
        formatDim(
          `No ${pc.cyan(".wtr.json")} found. Run ${pc.cyan("wtr init")} to configure file copying and port bumping.`,
        ),
      );
    }

    // Database cloning (--db)
    if (options.db !== undefined) {
      const dbSource = findDatabaseUrl(worktreePath) ?? findDatabaseUrl(mainWorktreePath);

      if (!dbSource) {
        if (!json) log.warning("No DATABASE_URL found in .env files — skipping database clone");
      } else {
        const templateDb = parseDatabaseName(dbSource.url);
        if (!templateDb) {
          if (!json) log.warning(`Could not parse database name from ${dbSource.key} — skipping database clone`);
        } else {
          // Determine new database name: use explicit name or derive from branch
          const newDbName =
            typeof options.db === "string"
              ? options.db
              : deriveDbName(templateDb, branch);

          s?.start(`Cloning database ${pc.cyan(templateDb)} → ${pc.cyan(newDbName)}`);
          const dbResult = createDatabase(newDbName, templateDb);

          if (!dbResult.ok) {
            s?.stop(pc.red("Database clone failed"));
            if (json) printJsonError(dbResult.error.message);
            else log.warning(dbResult.error.message);
          } else {
            s?.stop(pc.green("Database cloned"));

            // Update DATABASE_URL in the worktree's .env files
            const updateResult = updateDatabaseUrlInEnvFiles(worktreePath, newDbName);
            if (updateResult.ok && updateResult.value.length > 0) {
              if (!json) log.info(`Updated DATABASE_URL in: ${updateResult.value.join(", ")}`);
            }

            // Track the database name for cleanup on removal
            writeWorktreeDb(worktreePath, newDbName);
            jsonResult.database = { name: newDbName, template: templateDb };
          }
        }
      }
    }

    if (!json) {
      const env = buildWorktreeEnv({ path: worktreePath, branch });
      const configResult2 = loadConfig(repoRoot);
      const terminalMode = configResult2.ok
        ? configResult2.value.terminal.mode
        : "window";

      const autoMode = configResult2.ok
        ? configResult2.value.terminal.autoMode
        : true;

      if (options.plan || options.planFile) {
        const planText = await resolvePlanText(options);
        const planPath = writePlanToTempFile(planText);
        const command = buildClaudeCommand({ planPath, autoMode });
        log.info(`Plan written to ${formatPath(planPath)}`);

        openTerminalWindow({ cwd: worktreePath, command, env, mode: terminalMode });
        log.info("Opened terminal with Claude Code");
        log.info(
          "HANDOFF: A new Claude Code session has been launched in the worktree.",
        );
        log.info(
          "Do NOT continue working on the delegated task in this session.",
        );
      } else if (options.open) {
        const command = buildClaudeCommand({ autoMode });
        openTerminalWindow({ cwd: worktreePath, command, env, mode: terminalMode });
        log.info("Opened terminal with Claude Code");
        log.info(
          "HANDOFF: A new Claude Code session has been launched in the worktree.",
        );
        log.info(
          "Do NOT continue working on the delegated task in this session.",
        );
      }

      outro(
        `Worktree ready at ${formatPath(worktreePath)} for branch ${formatBranch(branch)}`,
      );
    } else {
      if (options.plan || options.planFile) {
        const planText = await resolvePlanText(options);
        const planPath = writePlanToTempFile(planText);
        const command = buildClaudeCommand({ planPath });
        jsonResult.command = command;
        jsonResult.planPath = planPath;
      }
      printJson(jsonResult);
    }
  });
