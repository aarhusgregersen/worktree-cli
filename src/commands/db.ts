import { Command } from "commander";
import pc from "picocolors";
import { getCurrentBranch } from "../core/branch.js";
import {
  createDatabase,
  deriveDbName,
  dropDatabase,
  ensureWorktreeEnv,
  findDatabaseUrl,
  parseConnection,
  parseDatabaseName,
  readWorktreeDb,
  updateDatabaseUrlInEnvFiles,
  writeWorktreeDb,
} from "../core/database.js";
import { ErrorCode } from "../core/errors.js";
import { getMainWorktreePath, isGitRepository } from "../core/git.js";
import { isInsideWorktree, listWorktrees } from "../core/worktree.js";
import { formatError, formatPath } from "../output/formatter.js";
import { printJson, printJsonError } from "../output/json.js";
import { intro, log, outro, spinner } from "../prompts/interactive.js";

const resolveWorktreePath = async (): Promise<string | undefined> => {
  const cwd = process.cwd();

  const listResult = await listWorktrees();
  if (!listResult.ok) return undefined;

  const worktree = isInsideWorktree(listResult.value, cwd);
  if (worktree) return worktree.path;

  // Check if we're in the main worktree
  const mainResult = await getMainWorktreePath();
  if (mainResult.ok) {
    const mainPath = mainResult.value;
    if (cwd === mainPath || cwd.startsWith(`${mainPath}/`)) {
      return mainPath;
    }
  }

  return undefined;
};

const cloneCommand = new Command("clone")
  .description("Clone the PostgreSQL database for the current worktree")
  .argument("[name]", "Database name (defaults to <template>_wtr_<branch>)")
  .option("--json", "Output as JSON")
  .action(async (nameArg: string | undefined, options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const worktreePath = await resolveWorktreePath();
    if (!worktreePath) {
      const msg = "Not inside any worktree";
      if (json) printJsonError(msg, ErrorCode.NOT_INSIDE_WORKTREE);
      console.error(formatError(msg));
      process.exit(1);
    }

    // Check if this worktree already has a database
    const existingDb = readWorktreeDb(worktreePath);
    if (existingDb) {
      const msg = `This worktree already has a cloned database: ${existingDb}`;
      if (json) printJsonError(msg);
      console.error(formatError(msg));
      process.exit(1);
    }

    if (!json) intro("wtr db clone");
    const s = json ? null : spinner();

    // Find the DATABASE_URL — check current worktree first, then main
    const mainResult = await getMainWorktreePath();
    const mainPath = mainResult.ok ? mainResult.value : undefined;

    const dbSource =
      findDatabaseUrl(worktreePath) ??
      (mainPath ? findDatabaseUrl(mainPath) : undefined);

    if (!dbSource) {
      const msg = "No DATABASE_URL found in .env files";
      if (json) printJsonError(msg);
      else console.error(formatError(msg));
      process.exit(1);
    }

    const templateDb = parseDatabaseName(dbSource.url);
    if (!templateDb) {
      const msg = `Could not parse database name from ${dbSource.key}`;
      if (json) printJsonError(msg);
      else console.error(formatError(msg));
      process.exit(1);
    }

    // Determine new database name
    let newDbName: string;
    if (nameArg) {
      newDbName = nameArg;
    } else {
      const branchResult = await getCurrentBranch();
      const branch = branchResult.ok ? branchResult.value : undefined;
      if (!branch) {
        const msg =
          "Could not determine branch name. Provide an explicit database name.";
        if (json) printJsonError(msg);
        else console.error(formatError(msg));
        process.exit(1);
      }
      newDbName = deriveDbName(templateDb, branch);
    }

    // Ensure the worktree has its own env file carrying DATABASE_URL before we
    // rewrite it to point at the clone. Falls back to copying main's env file.
    if (mainPath) {
      const envResult = ensureWorktreeEnv(
        worktreePath,
        mainPath,
        dbSource.file,
      );
      if (envResult.ok && envResult.value && !json) {
        log.info(`Copied ${dbSource.file} into worktree for DATABASE_URL`);
      }
    }

    const connection = parseConnection(dbSource.url);

    s?.start(`Cloning database ${pc.cyan(templateDb)} → ${pc.cyan(newDbName)}`);
    const dbResult = createDatabase(newDbName, templateDb, connection);

    if (!dbResult.ok) {
      s?.stop(pc.red("Failed"));
      if (json) printJsonError(dbResult.error.message);
      else console.error(formatError(dbResult.error.message));
      process.exit(1);
    }

    s?.stop(pc.green("Database cloned"));

    // Update DATABASE_URL in the worktree's .env files
    const updateResult = updateDatabaseUrlInEnvFiles(worktreePath, newDbName);
    if (updateResult.ok && updateResult.value.length > 0) {
      if (!json)
        log.info(`Updated DATABASE_URL in: ${updateResult.value.join(", ")}`);
    }

    writeWorktreeDb(worktreePath, newDbName);

    if (json) {
      printJson({
        database: newDbName,
        template: templateDb,
        path: worktreePath,
        updatedFiles: updateResult.ok ? updateResult.value : [],
      });
    } else {
      outro(`Database ${pc.cyan(newDbName)} ready`);
    }
  });

const dropCommand = new Command("drop")
  .description("Drop the cloned database for the current worktree")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const worktreePath = await resolveWorktreePath();
    if (!worktreePath) {
      const msg = "Not inside any worktree";
      if (json) printJsonError(msg, ErrorCode.NOT_INSIDE_WORKTREE);
      console.error(formatError(msg));
      process.exit(1);
    }

    const dbName = readWorktreeDb(worktreePath);
    if (!dbName) {
      const msg = "No cloned database found for this worktree";
      if (json) printJsonError(msg);
      console.error(formatError(msg));
      process.exit(1);
    }

    if (!json) intro("wtr db drop");
    const s = json ? null : spinner();

    // Reach the same server the clone lives on. The worktree's DATABASE_URL
    // already points at the clone, so its host/port/user are correct.
    const mainResult = await getMainWorktreePath();
    const dbSource =
      findDatabaseUrl(worktreePath) ??
      (mainResult.ok ? findDatabaseUrl(mainResult.value) : undefined);
    const connection = dbSource ? parseConnection(dbSource.url) : {};

    s?.start(`Dropping database ${pc.cyan(dbName)}`);
    const result = dropDatabase(dbName, connection);

    if (!result.ok) {
      s?.stop(pc.red("Failed"));
      if (json) printJsonError(result.error.message);
      else console.error(formatError(result.error.message));
      process.exit(1);
    }

    s?.stop(pc.green("Database dropped"));

    // Remove the tracking file
    const { unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    try {
      unlinkSync(join(worktreePath, ".wtr-db"));
    } catch {
      // ignore — file may already be gone
    }

    if (json) {
      printJson({ database: dbName, dropped: true, path: worktreePath });
    } else {
      outro(`Database ${pc.cyan(dbName)} dropped`);
    }
  });

const statusCommand = new Command("status")
  .description("Show the database associated with the current worktree")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const json = options.json ?? false;

    if (!isGitRepository()) {
      if (json)
        printJsonError("Not a git repository", ErrorCode.NOT_GIT_REPOSITORY);
      console.error(formatError("Not a git repository"));
      process.exit(1);
    }

    const worktreePath = await resolveWorktreePath();
    if (!worktreePath) {
      const msg = "Not inside any worktree";
      if (json) printJsonError(msg, ErrorCode.NOT_INSIDE_WORKTREE);
      console.error(formatError(msg));
      process.exit(1);
    }

    const dbName = readWorktreeDb(worktreePath);
    const dbSource = findDatabaseUrl(worktreePath);

    if (json) {
      printJson({
        path: worktreePath,
        clonedDatabase: dbName ?? null,
        databaseUrl: dbSource?.url ?? null,
        databaseKey: dbSource?.key ?? null,
      });
    } else {
      if (dbName) {
        console.log(
          `Cloned database: ${pc.cyan(dbName)} (at ${formatPath(worktreePath)})`,
        );
      } else {
        console.log("No cloned database for this worktree");
      }
      if (dbSource) {
        console.log(`${dbSource.key} → ${pc.dim(dbSource.url)}`);
      }
    }
  });

export const dbCommand = new Command("db")
  .description("Manage per-worktree PostgreSQL databases")
  .addCommand(cloneCommand)
  .addCommand(dropCommand)
  .addCommand(statusCommand);
