import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../utils/result.js";

export const ENV_FILENAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
] as const;

export interface EnvAssignment {
  readonly key: string;
  readonly value: string;
  readonly render: (value: string) => string;
}

export interface EnvFileSnapshot {
  readonly name: string;
  readonly path: string;
  readonly content: string;
}

export interface EnvRewriteResult {
  readonly updatedFiles: readonly string[];
  readonly originals: readonly EnvFileSnapshot[];
}

export const parseEnvAssignment = (line: string): EnvAssignment | undefined => {
  if (!line.trim() || line.trimStart().startsWith("#")) return undefined;

  const prefixMatch = line.match(
    /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/,
  );
  if (
    prefixMatch?.[1] === undefined ||
    !prefixMatch[2] ||
    prefixMatch[3] === undefined
  ) {
    return undefined;
  }

  const prefix = prefixMatch[1];
  const key = prefixMatch[2];
  const separator = prefixMatch[3];
  const remainder = prefixMatch[4] ?? "";
  const first = remainder[0];

  if (first === '"' || first === "'") {
    const closing = remainder.lastIndexOf(first);
    if (closing <= 0) return undefined;
    const value = remainder.slice(1, closing);
    const suffix = remainder.slice(closing + 1);
    return {
      key,
      value,
      render: (next) =>
        `${prefix}${key}${separator}${first}${next}${first}${suffix}`,
    };
  }

  const commentMatch = remainder.match(/^(.*?)(\s+#.*)$/);
  const rawValue = commentMatch?.[1] ?? remainder;
  const suffix = commentMatch?.[2] ?? "";
  const trailingWhitespace = rawValue.match(/\s*$/)?.[0] ?? "";
  const value = rawValue.slice(0, rawValue.length - trailingWhitespace.length);

  return {
    key,
    value,
    render: (next) =>
      `${prefix}${key}${separator}${next}${trailingWhitespace}${suffix}`,
  };
};

export const readEnvFiles = (dir: string): readonly EnvFileSnapshot[] =>
  ENV_FILENAMES.flatMap((name) => {
    const path = join(dir, name);
    return existsSync(path)
      ? [{ name, path, content: readFileSync(path, "utf-8") }]
      : [];
  });

export const rewriteEnvFiles = (
  dir: string,
  transform: (
    assignment: EnvAssignment,
    file: EnvFileSnapshot,
  ) => string | undefined,
): Result<EnvRewriteResult, Error> => {
  const originals = readEnvFiles(dir);
  const updatedFiles: string[] = [];

  try {
    for (const file of originals) {
      const newline = file.content.includes("\r\n") ? "\r\n" : "\n";
      const lines = file.content.split(/\r?\n/);
      let changed = false;
      const rewritten = lines.map((line) => {
        const assignment = parseEnvAssignment(line);
        if (!assignment) return line;
        const next = transform(assignment, file);
        if (next === undefined || next === assignment.value) return line;
        changed = true;
        return assignment.render(next);
      });

      if (changed) {
        writeFileSync(file.path, rewritten.join(newline));
        updatedFiles.push(file.name);
      }
    }
    return ok({ updatedFiles, originals });
  } catch (error) {
    restoreEnvFiles(originals);
    return err(
      new Error(
        `Failed to update env files: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

export const restoreEnvFiles = (
  snapshots: readonly EnvFileSnapshot[],
): Result<void, Error> => {
  try {
    for (const snapshot of snapshots) {
      writeFileSync(snapshot.path, snapshot.content);
    }
    return ok(undefined);
  } catch (error) {
    return err(
      new Error(
        `Failed to restore env files: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

export const restoreEnvDirectory = (
  dir: string,
  snapshots: readonly EnvFileSnapshot[],
): Result<void, Error> => {
  const snapshotNames = new Set(snapshots.map((snapshot) => snapshot.name));
  try {
    for (const name of ENV_FILENAMES) {
      const path = join(dir, name);
      if (!snapshotNames.has(name) && existsSync(path)) unlinkSync(path);
    }
    return restoreEnvFiles(snapshots);
  } catch (error) {
    return err(
      new Error(
        `Failed to restore env directory: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};
