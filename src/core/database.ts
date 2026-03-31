import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../utils/result.js";

const WTR_DB_FILE = ".wtr-db";

/**
 * Parse the database name from a DATABASE_URL.
 * Supports: postgresql://user:pass@host:port/dbname?params
 *           postgres://user:pass@host:port/dbname
 */
export const parseDatabaseName = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.slice(1); // remove leading /
    return dbName || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Replace the database name in a DATABASE_URL.
 */
export const replaceDatabaseName = (
  url: string,
  newDbName: string,
): string | undefined => {
  try {
    const parsed = new URL(url);
    parsed.pathname = `/${newDbName}`;
    return parsed.toString();
  } catch {
    return undefined;
  }
};

/**
 * Find DATABASE_URL in .env files within a directory and return the first match.
 */
export const findDatabaseUrl = (
  dir: string,
): { file: string; key: string; url: string } | undefined => {
  const envFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ];

  for (const envFile of envFiles) {
    const filePath = join(dir, envFile);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed) continue;

      const match = trimmed.match(
        /^(DATABASE_URL|DB_URL|POSTGRES_URL)=["']?(.+?)["']?$/,
      );
      if (match?.[1] && match[2]) {
        return { file: envFile, key: match[1], url: match[2] };
      }
    }
  }

  return undefined;
};

/**
 * Update DATABASE_URL in all .env files within a directory, replacing the
 * database name portion of the URL.
 */
export const updateDatabaseUrlInEnvFiles = (
  dir: string,
  newDbName: string,
): Result<string[], Error> => {
  const envFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ];
  const updated: string[] = [];

  for (const envFile of envFiles) {
    const filePath = join(dir, envFile);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    let changed = false;

    const newLines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed) return line;

      const match = trimmed.match(
        /^(DATABASE_URL|DB_URL|POSTGRES_URL)=["']?(.+?)["']?$/,
      );
      if (!match?.[1] || !match[2]) return line;

      const newUrl = replaceDatabaseName(match[2], newDbName);
      if (!newUrl) return line;

      changed = true;
      return `${match[1]}=${newUrl}`;
    });

    if (changed) {
      writeFileSync(filePath, newLines.join("\n"));
      updated.push(envFile);
    }
  }

  return ok(updated);
};

/**
 * Create a new PostgreSQL database by cloning an existing one using
 * `createdb -T <template>`. Requires no active connections to the template.
 */
export const createDatabase = (
  newName: string,
  templateName: string,
): Result<string, Error> => {
  try {
    execSync(`createdb "${newName}" -T "${templateName}"`, {
      stdio: "pipe",
    });
    return ok(newName);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("already exists")) {
      return err(new Error(`Database "${newName}" already exists`));
    }
    if (message.includes("being accessed by other users")) {
      return err(
        new Error(
          `Cannot clone "${templateName}": database has active connections. Close all connections and retry.`,
        ),
      );
    }

    return err(
      new Error(`Failed to create database "${newName}": ${message}`),
    );
  }
};

/**
 * Drop a PostgreSQL database using `dropdb`.
 */
export const dropDatabase = (name: string): Result<void, Error> => {
  try {
    execSync(`dropdb "${name}" --if-exists`, { stdio: "pipe" });
    return ok(undefined);
  } catch (error) {
    return err(
      new Error(
        `Failed to drop database "${name}": ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

/**
 * Write the database name to a .wtr-db tracking file in the worktree.
 */
export const writeWorktreeDb = (
  worktreePath: string,
  dbName: string,
): void => {
  writeFileSync(join(worktreePath, WTR_DB_FILE), dbName, "utf-8");
};

/**
 * Read the database name from a .wtr-db tracking file in the worktree.
 * Returns undefined if the file doesn't exist.
 */
export const readWorktreeDb = (
  worktreePath: string,
): string | undefined => {
  const filePath = join(worktreePath, WTR_DB_FILE);
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, "utf-8").trim();
};

/**
 * Sanitize a branch name into a valid PostgreSQL database name suffix.
 */
export const sanitizeBranchForDb = (branch: string): string => {
  return branch
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
};

/**
 * Derive a database name from a template DB and branch name.
 * Example: template "myapp_dev", branch "feature/auth" → "myapp_dev_wtr_feature_auth"
 */
export const deriveDbName = (
  templateDb: string,
  branch: string,
): string => {
  const suffix = sanitizeBranchForDb(branch);
  return `${templateDb}_wtr_${suffix}`;
};
