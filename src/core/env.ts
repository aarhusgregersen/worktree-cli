import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isExcludedPort } from "../config/schema.js";
import { type Result, err, ok } from "../utils/result.js";
import {
  parseEnvAssignment,
  readEnvFiles,
  rewriteEnvFiles,
} from "./envDocument.js";

interface PortBumpResult {
  readonly file: string;
  readonly changes: readonly {
    key: string;
    oldPort: number;
    newPort: number;
  }[];
}

export const PORT_PATTERN =
  /^([A-Z_][A-Z0-9_]*(?:PORT|_PORT)[A-Z0-9_]*)=["']?(\d+)["']?$/i;
export const URL_PORT_PATTERN =
  /^([A-Z_][A-Z0-9_]*(?:URL|URI|HOST)[A-Z0-9_]*)=["']?(.+:)(\d+)(.*?)["']?$/i;

export const copyFiles = (
  sourceRoot: string,
  targetRoot: string,
  patterns: readonly string[],
): Result<string[], Error> => {
  const copied: string[] = [];

  for (const pattern of patterns) {
    const sourcePath = resolve(sourceRoot, pattern);
    const targetPath = resolve(targetRoot, pattern);

    const relToSource = relative(sourceRoot, sourcePath);
    if (relToSource.startsWith("..") || isAbsolute(relToSource)) {
      return err(
        new Error(`Refusing to copy "${pattern}": path escapes source root`),
      );
    }

    const relToTarget = relative(targetRoot, targetPath);
    if (relToTarget.startsWith("..") || isAbsolute(relToTarget)) {
      return err(
        new Error(`Refusing to copy "${pattern}": path escapes target root`),
      );
    }

    if (!existsSync(sourcePath)) {
      continue;
    }

    try {
      const targetDir = dirname(targetPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      cpSync(sourcePath, targetPath, { recursive: true });
      copied.push(pattern);
    } catch (error) {
      return err(
        new Error(
          `Failed to copy ${pattern}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  return ok(copied);
};

export const bumpPortsInEnvFiles = (
  targetRoot: string,
  offset: number,
  exclusions: readonly string[],
): Result<PortBumpResult[], Error> => {
  const results: PortBumpResult[] = [];
  const changesByFile = new Map<string, PortBumpResult["changes"]>();

  for (const file of readEnvFiles(targetRoot)) {
    const lines = file.content.split(/\r?\n/);
    const result = transformPortLines(lines, offset, exclusions);
    if (result.changes.length === 0) continue;
    changesByFile.set(file.name, result.changes);
    results.push({ file: file.name, changes: result.changes });
  }

  const rewrite = rewriteEnvFiles(targetRoot, (assignment, file) => {
    const change = changesByFile
      .get(file.name)
      ?.find(
        (candidate) =>
          candidate.key === assignment.key &&
          (assignment.value === String(candidate.oldPort) ||
            assignment.value.includes(`:${candidate.oldPort}`)),
      );
    if (!change) return undefined;
    return assignment.value.replace(
      String(change.oldPort),
      String(change.newPort),
    );
  });
  if (!rewrite.ok) return rewrite;

  return ok(results);
};

export const transformPortLines = (
  lines: readonly string[],
  offset: number,
  exclusions: readonly string[],
): {
  newLines: string[];
  changes: { key: string; oldPort: number; newPort: number }[];
} => {
  const changes: { key: string; oldPort: number; newPort: number }[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    const assignment = parseEnvAssignment(line);
    if (!assignment) {
      newLines.push(line);
      continue;
    }

    const normalized = `${assignment.key}=${assignment.value}`;
    const portMatch = normalized.match(PORT_PATTERN);
    if (portMatch) {
      const key = portMatch[1];
      const portStr = portMatch[2];

      if (key && portStr && !isExcludedPort(key, exclusions)) {
        const oldPort = Number.parseInt(portStr, 10);
        const newPort = oldPort + offset;
        changes.push({ key, oldPort, newPort });
        newLines.push(assignment.render(String(newPort)));
        continue;
      }
    }

    const urlMatch = normalized.match(URL_PORT_PATTERN);
    if (urlMatch) {
      const key = urlMatch[1];
      const portStr = urlMatch[3];

      if (key && portStr && !isExcludedPort(key, exclusions)) {
        const oldPort = Number.parseInt(portStr, 10);
        const newPort = oldPort + offset;
        changes.push({ key, oldPort, newPort });
        newLines.push(
          assignment.render(
            assignment.value.replace(`:${portStr}`, `:${newPort}`),
          ),
        );
        continue;
      }
    }

    newLines.push(line);
  }

  return { newLines, changes };
};
