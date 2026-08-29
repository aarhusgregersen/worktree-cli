import { Command } from "commander";
import pc from "picocolors";
import { fail, runCliAction, unwrapCli } from "../cliRuntime.js";
import { getCurrentBranch } from "../core/branch.js";
import {
  dropDatabase,
  findDatabaseUrl,
  parseConnection,
  readWorktreeDb,
  removeWorktreeDb,
} from "../core/database.js";
import { CliCancelled, ErrorCode } from "../core/errors.js";
import { getMainWorktreePath } from "../core/git.js";
import { cloneDatabaseForWorktree } from "../core/lifecycle.js";
import { isInsideWorktree } from "../core/worktree.js";
import { formatPath } from "../output/formatter.js";
import { confirmDestructive } from "../prompts/interactive.js";
import { requireGitRepository, requireWorktrees } from "./shared.js";

const resolveWorktreePath = async (): Promise<string> => {
  const cwd = process.cwd();
  const worktree = isInsideWorktree(await requireWorktrees(), cwd);
  if (worktree) return worktree.path;

  const mainPath = unwrapCli(await getMainWorktreePath());
  if (cwd === mainPath || cwd.startsWith(`${mainPath}/`)) return mainPath;
  return fail("Not inside any worktree", {
    code: ErrorCode.NOT_INSIDE_WORKTREE,
  });
};

const createCloneCommand = (): Command =>
  new Command("clone")
    .description("Clone the PostgreSQL database for the current worktree")
    .argument("[name]", "Database name (defaults to <template>_wtr_<branch>)")
    .option("--json", "Output as JSON")
    .action(async (name: string | undefined, options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktreePath = await resolveWorktreePath();
          const existing = readWorktreeDb(worktreePath);
          if (existing) {
            return fail(
              `This worktree already has a cloned database: ${existing}`,
              { code: ErrorCode.DATABASE_CLONE_FAILED },
            );
          }

          const mainPath = unwrapCli(await getMainWorktreePath());
          let branch = name;
          if (!branch) {
            const branchResult = await getCurrentBranch();
            if (!branchResult.ok || !branchResult.value) {
              return fail(
                "Could not determine branch name. Provide an explicit database name.",
                { code: ErrorCode.DATABASE_CLONE_FAILED },
              );
            }
            branch = branchResult.value;
          }

          reporter.intro("wtr db clone");
          const progress = reporter.spinner();
          progress.start("Cloning database");
          const cloned = cloneDatabaseForWorktree({
            worktreePath,
            mainPath,
            branch,
            ...(name ? { name } : {}),
          });
          if (!cloned.ok) throw cloned.error;
          progress.stop(pc.green("Database cloned"));
          if (cloned.value.copiedEnvFile) {
            reporter.info("Copied env file into worktree for DATABASE_URL");
          }
          return {
            database: cloned.value.name,
            template: cloned.value.template,
            path: worktreePath,
            updatedFiles: cloned.value.updatedFiles,
          };
        },
        renderHuman: ({ database }, reporter) =>
          reporter.outro(`Database ${pc.cyan(database)} ready`),
      });
    });

const createDropCommand = (): Command =>
  new Command("drop")
    .description("Drop the cloned database for the current worktree")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async (reporter) => {
          requireGitRepository();
          const worktreePath = await resolveWorktreePath();
          const database = readWorktreeDb(worktreePath);
          if (!database) {
            return fail("No cloned database found for this worktree", {
              code: ErrorCode.DATABASE_DROP_FAILED,
            });
          }

          reporter.intro("wtr db drop");
          if (reporter.interactive && !options.yes) {
            const confirmed = await confirmDestructive(
              `Drop database ${pc.cyan(database)}?`,
            );
            if (!confirmed) {
              reporter.outro("Aborted");
              throw new CliCancelled();
            }
          }

          const mainPath = unwrapCli(await getMainWorktreePath());
          const source =
            findDatabaseUrl(worktreePath) ?? findDatabaseUrl(mainPath);
          const progress = reporter.spinner();
          progress.start(`Dropping database ${pc.cyan(database)}`);
          const dropped = dropDatabase(
            database,
            source ? parseConnection(source.url) : {},
          );
          if (!dropped.ok) {
            return fail(dropped.error.message, {
              code: ErrorCode.DATABASE_DROP_FAILED,
              cause: dropped.error,
            });
          }
          unwrapCli(removeWorktreeDb(worktreePath), {
            code: ErrorCode.DATABASE_DROP_FAILED,
          });
          progress.stop(pc.green("Database dropped"));
          return { database, dropped: true as const, path: worktreePath };
        },
        renderHuman: ({ database }, reporter) =>
          reporter.outro(`Database ${pc.cyan(database)} dropped`),
      });
    });

const createStatusCommand = (): Command =>
  new Command("status")
    .description("Show the database associated with the current worktree")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      await runCliAction({
        json: options.json ?? false,
        action: async () => {
          requireGitRepository();
          const path = await resolveWorktreePath();
          const database = readWorktreeDb(path);
          const source = findDatabaseUrl(path);
          return {
            path,
            clonedDatabase: database ?? null,
            databaseUrl: source?.url ?? null,
            databaseKey: source?.key ?? null,
          };
        },
        renderHuman: (result) => {
          console.log(
            result.clonedDatabase
              ? `Cloned database: ${pc.cyan(result.clonedDatabase)} (at ${formatPath(result.path)})`
              : "No cloned database for this worktree",
          );
          if (result.databaseUrl && result.databaseKey) {
            console.log(
              `${result.databaseKey} → ${pc.dim(result.databaseUrl)}`,
            );
          }
        },
      });
    });

export const createDbCommand = (): Command =>
  new Command("db")
    .description("Manage per-worktree PostgreSQL databases")
    .addCommand(createCloneCommand())
    .addCommand(createDropCommand())
    .addCommand(createStatusCommand());
