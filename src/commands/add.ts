import { resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { runCliAction, unwrapCli } from "../cliRuntime.js";
import { configExists, globalConfigExists } from "../config/loader.js";
import { branchExists, fetchOrigin, getDefaultBranch } from "../core/branch.js";
import { bumpPortsInEnvFiles, copyFiles } from "../core/env.js";
import { CliError, ErrorCode } from "../core/errors.js";
import { getMainWorktreePath } from "../core/git.js";
import {
  type LaunchSpec,
  executeLaunchSpec,
  prepareLaunchSpec,
} from "../core/launch.js";
import { cloneDatabaseForWorktree } from "../core/lifecycle.js";
import {
  addWorktree,
  isInsideWorktree,
  listWorktrees,
} from "../core/worktree.js";
import { canonicalize, resolveWorktreeRoot } from "../core/worktreeRoot.js";
import { formatBranch, formatDim, formatPath } from "../output/formatter.js";
import {
  requireConfig,
  requireGitRepository,
  requireRepoRoot,
} from "./shared.js";

interface AddJsonResult {
  readonly path: string;
  readonly worktreeRoot: ReturnType<typeof resolveWorktreeRoot>;
  readonly branch: string;
  readonly branchCreated: boolean;
  readonly filesCopied: readonly string[];
  readonly portsBumped: readonly {
    readonly file: string;
    readonly changes: readonly {
      readonly key: string;
      readonly oldPort: number;
      readonly newPort: number;
    }[];
  }[];
  readonly portOffset: number;
  readonly database?: { readonly name: string; readonly template: string };
  readonly command?: string;
  readonly planPath?: string;
}

interface AddOutcome {
  readonly result: AddJsonResult;
  readonly launch?: LaunchSpec;
}

export const createAddCommand = (): Command =>
  new Command("add")
    .description("Create a new worktree")
    .argument("<branch>", "Branch name (existing or new)")
    .argument("[path]", "Worktree path (optional)")
    .option("-b, --create", "Create new branch if it does not exist")
    .option("-B, --force-create", "Create or reset branch")
    .option(
      "--base <ref>",
      "Base ref for new branch (default: origin/<default-branch>)",
    )
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
    .option(
      "--model <name>",
      "Model for the new Claude Code session (e.g. sonnet, opus, haiku)",
    )
    .option("--json", "Output as JSON")
    .action(async (branch: string, pathArg: string | undefined, options) => {
      await runCliAction<AddOutcome>({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const repoRoot = await requireRepoRoot();
          const mainWorktreePath = unwrapCli(await getMainWorktreePath());
          const config = requireConfig(repoRoot);
          const hasConfig = configExists(repoRoot) || globalConfigExists();
          const safeBranchName = branch.replace(/\//g, "-");
          const worktreeRoot = resolveWorktreeRoot({
            mainWorktreePath,
            configured: config.worktreeDir,
          });
          const worktreePath = pathArg
            ? canonicalize(pathArg)
            : resolve(worktreeRoot.path, safeBranchName);

          const existingWorktrees = unwrapCli(await listWorktrees());
          const enclosing = isInsideWorktree(existingWorktrees, worktreePath);
          if (enclosing) {
            throw new CliError(
              `Cannot create a worktree inside another worktree (${enclosing.path}).`,
              { code: ErrorCode.INSIDE_WORKTREE },
            );
          }

          const exists = await branchExists(branch);
          const shouldCreateBranch = !exists && !options.detach;
          reporter.intro("wtr add");
          const progress = reporter.spinner();

          let baseRef: string | undefined = options.base;
          if (!baseRef && shouldCreateBranch) {
            progress.start("Fetching origin");
            const fetched = await fetchOrigin();
            if (fetched.ok) progress.stop(pc.green("Fetched origin"));
            else {
              progress.stop(
                pc.yellow("Fetch failed (continuing with local state)"),
              );
              reporter.warning(fetched.error.message);
            }
            baseRef = `origin/${await getDefaultBranch()}`;
          }

          progress.start(`Creating worktree at ${formatPath(worktreePath)}`);
          unwrapCli(
            await addWorktree({
              path: worktreePath,
              branch,
              createBranch: (options.create ?? false) || shouldCreateBranch,
              forceCreate: options.forceCreate ?? false,
              baseRef,
              detach: options.detach ?? false,
            }),
          );
          progress.stop(pc.green("Worktree created"));

          if (shouldCreateBranch && !options.create && !options.forceCreate) {
            reporter.info(`Branch '${branch}' did not exist and was created`);
          }

          let filesCopied: readonly string[] = [];
          if (options.copy !== false && config.copyFiles.length > 0) {
            progress.start("Copying configuration files");
            const copied = copyFiles(
              mainWorktreePath,
              worktreePath,
              config.copyFiles,
            );
            if (copied.ok) {
              filesCopied = copied.value;
              progress.stop(
                copied.value.length > 0
                  ? pc.green("Files copied")
                  : formatDim("No files to copy"),
              );
              if (copied.value.length > 0) {
                reporter.info(`Copied: ${copied.value.join(", ")}`);
              }
            } else {
              progress.stop(pc.yellow("Copy failed"));
              reporter.warning(copied.error.message);
            }
          } else if (!hasConfig) {
            reporter.info(
              formatDim(
                `No ${pc.cyan(".wtr.json")} found. Run ${pc.cyan("wtr init")} to configure file copying and port bumping.`,
              ),
            );
          }

          let database: AddJsonResult["database"];
          if (options.db !== undefined) {
            progress.start("Cloning database");
            const cloned = cloneDatabaseForWorktree({
              worktreePath,
              mainPath: mainWorktreePath,
              branch,
              ...(typeof options.db === "string" ? { name: options.db } : {}),
            });
            if (!cloned.ok) throw cloned.error;
            progress.stop(pc.green("Database cloned"));
            database = {
              name: cloned.value.name,
              template: cloned.value.template,
            };
            if (cloned.value.copiedEnvFile) {
              reporter.info("Copied env file into worktree for DATABASE_URL");
            }
            reporter.info(
              `Updated DATABASE_URL in: ${cloned.value.updatedFiles.join(", ")}`,
            );
          }

          let portsBumped: AddJsonResult["portsBumped"] = [];
          let portOffset = 0;
          if (options.bump !== false && config.portOffset > 0) {
            const freshWorktrees = unwrapCli(await listWorktrees());
            const worktreeIndex = freshWorktrees.length - 1;
            if (worktreeIndex > 0) {
              portOffset = config.portOffset * worktreeIndex;
              progress.start(`Bumping ports by +${portOffset}`);
              const bumped = bumpPortsInEnvFiles(
                worktreePath,
                portOffset,
                config.portExclusions,
              );
              if (bumped.ok) {
                portsBumped = bumped.value;
                progress.stop(
                  bumped.value.length > 0
                    ? pc.green("Ports updated")
                    : formatDim("No ports to bump"),
                );
                for (const file of bumped.value) {
                  reporter.info(
                    `${file.file}: ${file.changes
                      .map(
                        (change) =>
                          `${change.key}: ${change.oldPort} -> ${change.newPort}`,
                      )
                      .join(", ")}`,
                  );
                }
              } else {
                progress.stop(pc.yellow("Port bump failed"));
                reporter.warning(bumped.error.message);
              }
            }
          }

          const shouldLaunch = Boolean(
            options.open || options.plan || options.planFile,
          );
          const launch = shouldLaunch
            ? await prepareLaunchSpec({
                cwd: worktreePath,
                branch,
                terminal: config.terminal,
                startClaude: true,
                plan: options.plan,
                planFile: options.planFile,
                model: options.model,
              })
            : undefined;
          if (launch?.planPath) {
            reporter.info(`Plan written to ${formatPath(launch.planPath)}`);
          }
          if (launch && reporter.interactive) executeLaunchSpec(launch);

          return {
            result: {
              path: worktreePath,
              worktreeRoot,
              branch,
              branchCreated: shouldCreateBranch,
              filesCopied,
              portsBumped,
              portOffset,
              ...(database ? { database } : {}),
              ...(launch?.command ? { command: launch.command } : {}),
              ...(launch?.planPath ? { planPath: launch.planPath } : {}),
            },
            launch,
          };
        },
        renderJson: ({ result }) => result,
        renderHuman: ({ result, launch }, reporter) => {
          if (launch?.handoff) {
            reporter.info("Opened terminal with Claude Code");
            reporter.info(
              "HANDOFF: A new Claude Code session has been launched in the worktree.",
            );
            reporter.info(
              "Do NOT continue working on the delegated task in this session.",
            );
          }
          reporter.outro(
            `Worktree ready at ${formatPath(result.path)} for branch ${formatBranch(result.branch)}`,
          );
        },
      });
    });
