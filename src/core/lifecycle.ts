import { type Result, err, ok } from "../utils/result.js";
import {
  createDatabase,
  deriveDbName,
  dropDatabase,
  ensureWorktreeEnv,
  findDatabaseUrl,
  parseConnection,
  parseDatabaseName,
  readWorktreeDb,
  removeWorktreeDb,
  updateDatabaseUrlInEnvFiles,
  writeWorktreeDb,
} from "./database.js";
import { readEnvFiles, restoreEnvDirectory } from "./envDocument.js";
import { CliError, ErrorCode } from "./errors.js";
import { getMainWorktreePath } from "./git.js";
import { type WorktreeInfo, removeWorktree } from "./worktree.js";

export interface LifecycleDependencies {
  readonly createDatabase: typeof createDatabase;
  readonly dropDatabase: typeof dropDatabase;
  readonly ensureWorktreeEnv: typeof ensureWorktreeEnv;
  readonly findDatabaseUrl: typeof findDatabaseUrl;
  readonly getMainWorktreePath: typeof getMainWorktreePath;
  readonly readWorktreeDb: typeof readWorktreeDb;
  readonly removeWorktree: typeof removeWorktree;
  readonly removeWorktreeDb: typeof removeWorktreeDb;
  readonly updateDatabaseUrlInEnvFiles: typeof updateDatabaseUrlInEnvFiles;
  readonly writeWorktreeDb: typeof writeWorktreeDb;
  readonly readEnvFiles: typeof readEnvFiles;
  readonly restoreEnvDirectory: typeof restoreEnvDirectory;
}

export const defaultLifecycleDependencies: LifecycleDependencies = {
  createDatabase,
  dropDatabase,
  ensureWorktreeEnv,
  findDatabaseUrl,
  getMainWorktreePath,
  readWorktreeDb,
  removeWorktree,
  removeWorktreeDb,
  updateDatabaseUrlInEnvFiles,
  writeWorktreeDb,
  readEnvFiles,
  restoreEnvDirectory,
};

export interface DatabaseCloneResult {
  readonly name: string;
  readonly template: string;
  readonly updatedFiles: readonly string[];
  readonly copiedEnvFile: boolean;
}

export const cloneDatabaseForWorktree = (
  options: {
    readonly worktreePath: string;
    readonly mainPath: string;
    readonly branch: string;
    readonly name?: string;
  },
  dependencies: LifecycleDependencies = defaultLifecycleDependencies,
): Result<DatabaseCloneResult, CliError> => {
  const before = dependencies.readEnvFiles(options.worktreePath);
  const source =
    dependencies.findDatabaseUrl(options.worktreePath) ??
    dependencies.findDatabaseUrl(options.mainPath);
  if (!source) {
    return err(
      new CliError("No DATABASE_URL found in .env files", {
        code: ErrorCode.DATABASE_CLONE_FAILED,
      }),
    );
  }

  const template = parseDatabaseName(source.url);
  if (!template) {
    return err(
      new CliError(`Could not parse database name from ${source.key}`, {
        code: ErrorCode.DATABASE_CLONE_FAILED,
      }),
    );
  }

  const ensured = dependencies.ensureWorktreeEnv(
    options.worktreePath,
    options.mainPath,
    source.file,
  );
  if (!ensured.ok) {
    return err(
      new CliError(ensured.error.message, {
        code: ErrorCode.DATABASE_CLONE_FAILED,
        cause: ensured.error,
      }),
    );
  }

  const name = options.name ?? deriveDbName(template, options.branch);
  const connection = parseConnection(source.url);
  const created = dependencies.createDatabase(name, template, connection);
  if (!created.ok) {
    dependencies.restoreEnvDirectory(options.worktreePath, before);
    return err(
      new CliError(created.error.message, {
        code: ErrorCode.DATABASE_CLONE_FAILED,
        cause: created.error,
      }),
    );
  }

  const failAfterCreate = (cause: Error): Result<never, CliError> => {
    const restored = dependencies.restoreEnvDirectory(
      options.worktreePath,
      before,
    );
    dependencies.removeWorktreeDb(options.worktreePath);
    const rolledBack = dependencies.dropDatabase(name, connection);
    const orphaned = !rolledBack.ok;
    return err(
      new CliError(cause.message, {
        code: ErrorCode.DATABASE_CLONE_FAILED,
        cause,
        details: {
          database: name,
          orphaned,
          envRestored: restored.ok,
          ...(rolledBack.ok ? {} : { rollbackError: rolledBack.error.message }),
        },
      }),
    );
  };

  const updated = dependencies.updateDatabaseUrlInEnvFiles(
    options.worktreePath,
    name,
  );
  if (!updated.ok) return failAfterCreate(updated.error);
  if (updated.value.length === 0) {
    return failAfterCreate(
      new Error("No worktree env file contained a database URL to update"),
    );
  }

  const tracked = dependencies.writeWorktreeDb(options.worktreePath, name);
  if (!tracked.ok) return failAfterCreate(tracked.error);

  return ok({
    name,
    template,
    updatedFiles: updated.value,
    copiedEnvFile: ensured.value,
  });
};

export interface ManagedWorktreeRemovalResult {
  readonly path: string;
  readonly branch: string | undefined;
  readonly removed: true;
  readonly database?: string;
  readonly databaseDropped?: boolean;
  readonly orphanedDatabase?: string;
}

export const removeManagedWorktree = async (
  options: {
    readonly worktree: WorktreeInfo;
    readonly force: boolean;
    readonly mainPath?: string;
  },
  dependencies: LifecycleDependencies = defaultLifecycleDependencies,
): Promise<Result<ManagedWorktreeRemovalResult, CliError>> => {
  const database = dependencies.readWorktreeDb(options.worktree.path);
  let databaseDropped: boolean | undefined;
  let orphanedDatabase: string | undefined;

  if (database) {
    const mainResult = options.mainPath
      ? ok(options.mainPath)
      : await dependencies.getMainWorktreePath();
    const source =
      dependencies.findDatabaseUrl(options.worktree.path) ??
      (mainResult.ok
        ? dependencies.findDatabaseUrl(mainResult.value)
        : undefined);
    const dropped = dependencies.dropDatabase(
      database,
      source ? parseConnection(source.url) : {},
    );

    if (!dropped.ok && !options.force) {
      return err(
        new CliError(dropped.error.message, {
          code: ErrorCode.DATABASE_DROP_FAILED,
          cause: dropped.error,
          details: { database, path: options.worktree.path },
        }),
      );
    }
    databaseDropped = dropped.ok;
    if (!dropped.ok) orphanedDatabase = database;
  }

  const removed = await dependencies.removeWorktree({
    path: options.worktree.path,
    force: options.force,
  });
  if (!removed.ok) {
    return err(new CliError(removed.error.message, { cause: removed.error }));
  }

  return ok({
    path: options.worktree.path,
    branch: options.worktree.branch,
    removed: true,
    ...(database ? { database, databaseDropped } : {}),
    ...(orphanedDatabase ? { orphanedDatabase } : {}),
  });
};

export type ManagedWorktreeBatchItem =
  | {
      readonly ok: true;
      readonly worktree: WorktreeInfo;
      readonly value: ManagedWorktreeRemovalResult;
    }
  | {
      readonly ok: false;
      readonly worktree: WorktreeInfo;
      readonly error: CliError;
    };

export const removeManagedWorktrees = async (
  worktrees: readonly WorktreeInfo[],
  force: boolean,
  dependencies: LifecycleDependencies = defaultLifecycleDependencies,
): Promise<readonly ManagedWorktreeBatchItem[]> => {
  const results: ManagedWorktreeBatchItem[] = [];
  for (const worktree of worktrees) {
    const result = await removeManagedWorktree(
      { worktree, force },
      dependencies,
    );
    results.push(
      result.ok
        ? { ok: true, worktree, value: result.value }
        : { ok: false, worktree, error: result.error },
    );
  }
  return results;
};
