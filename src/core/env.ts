import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isExcludedPort } from "../config/schema.js";
import { type Result, err, ok } from "../utils/result.js";

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
        new Error(
          `Refusing to copy "${pattern}": path escapes source root`,
        ),
      );
    }

    const relToTarget = relative(targetRoot, targetPath);
    if (relToTarget.startsWith("..") || isAbsolute(relToTarget)) {
      return err(
        new Error(
          `Refusing to copy "${pattern}": path escapes target root`,
        ),
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
  const envFiles = findEnvFiles(targetRoot);

  for (const file of envFiles) {
    const result = bumpPortsInFile(file, offset, exclusions);
    if (!result.ok) return result;
    if (result.value.changes.length > 0) {
      results.push(result.value);
    }
  }

  return ok(results);
};

const findEnvFiles = (dir: string): string[] => {
  const files: string[] = [];
  const envPatterns = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ];

  for (const pattern of envPatterns) {
    const filePath = join(dir, pattern);
    if (existsSync(filePath)) {
      files.push(filePath);
    }
  }

  return files;
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
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      newLines.push(line);
      continue;
    }

    const portMatch = trimmed.match(PORT_PATTERN);
    if (portMatch) {
      const key = portMatch[1];
      const portStr = portMatch[2];

      if (key && portStr && !isExcludedPort(key, exclusions)) {
        const oldPort = Number.parseInt(portStr, 10);
        const newPort = oldPort + offset;
        changes.push({ key, oldPort, newPort });
        newLines.push(line.replace(`=${portStr}`, `=${newPort}`));
        continue;
      }
    }

    const urlMatch = trimmed.match(URL_PORT_PATTERN);
    if (urlMatch) {
      const key = urlMatch[1];
      const portStr = urlMatch[3];

      if (key && portStr && !isExcludedPort(key, exclusions)) {
        const oldPort = Number.parseInt(portStr, 10);
        const newPort = oldPort + offset;
        changes.push({ key, oldPort, newPort });
        newLines.push(line.replace(`:${portStr}`, `:${newPort}`));
        continue;
      }
    }

    newLines.push(line);
  }

  return { newLines, changes };
};

const bumpPortsInFile = (
  filePath: string,
  offset: number,
  exclusions: readonly string[],
): Result<PortBumpResult, Error> => {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const { newLines, changes } = transformPortLines(lines, offset, exclusions);

    if (changes.length > 0) {
      writeFileSync(filePath, newLines.join("\n"));
    }

    return ok({
      file: basename(filePath),
      changes,
    });
  } catch (error) {
    return err(
      new Error(
        `Failed to process ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};
