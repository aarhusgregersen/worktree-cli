import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../utils/result.js";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  DEFAULT_TERMINAL_CONFIG,
  GLOBAL_CONFIG_PATH,
  LEGACY_GLOBAL_CONFIG_PATH,
  type WtConfig,
  type WtConfigInput,
  wtConfigInputSchema,
  wtConfigSchema,
} from "./schema.js";

const resolveGlobalConfigPath = (): string | null => {
  if (existsSync(GLOBAL_CONFIG_PATH)) return GLOBAL_CONFIG_PATH;
  if (existsSync(LEGACY_GLOBAL_CONFIG_PATH)) return LEGACY_GLOBAL_CONFIG_PATH;
  return null;
};

const formatConfigError = (path: string, error: unknown): Error => {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    const issues = error.issues
      .map((issue) => {
        if (!issue || typeof issue !== "object") return String(issue);
        const issuePath =
          "path" in issue && Array.isArray(issue.path)
            ? issue.path.join(".") || "<root>"
            : "<root>";
        const message =
          "message" in issue ? String(issue.message) : "Invalid value";
        return `${issuePath}: ${message}`;
      })
      .join("; ");
    return new Error(`Invalid config (${path}): ${issues}`);
  }
  return new Error(
    `Failed to parse config (${path}): ${error instanceof Error ? error.message : String(error)}`,
  );
};

export const parseConfigText = (
  path: string,
  content: string,
): Result<WtConfigInput, Error> => {
  try {
    return ok(wtConfigInputSchema.parse(JSON.parse(content)));
  } catch (error) {
    return err(formatConfigError(path, error));
  }
};

export const loadGlobalConfig = (): Result<WtConfigInput, Error> => {
  const path = resolveGlobalConfigPath();
  if (!path) {
    return ok({});
  }

  try {
    const content = readFileSync(path, "utf-8");
    return parseConfigText(path, content);
  } catch (error) {
    return err(
      new Error(
        `Failed to read global config (${path}): ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

export const globalConfigExists = (): boolean => {
  return resolveGlobalConfigPath() !== null;
};

export const mergeConfig = (
  base: WtConfig,
  override: WtConfigInput,
): WtConfig => {
  const worktreeDir = override.worktreeDir ?? base.worktreeDir;

  return {
    copyFiles: override.copyFiles ?? base.copyFiles,
    ...(worktreeDir ? { worktreeDir } : {}),
    portOffset: override.portOffset ?? base.portOffset,
    portExclusions: override.portExclusions ?? base.portExclusions,
    db: override.db ?? base.db,
    terminal: {
      ...DEFAULT_TERMINAL_CONFIG,
      ...base.terminal,
      ...(override.terminal ?? {}),
    },
  };
};

export const loadConfig = (repoRoot: string): Result<WtConfig, Error> => {
  // Start with defaults
  let config: WtConfig = { ...DEFAULT_CONFIG };

  // Merge global config
  const globalResult = loadGlobalConfig();
  if (!globalResult.ok) return globalResult;
  config = mergeConfig(config, globalResult.value);

  // Merge local config
  const configPath = join(repoRoot, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return ok(config);
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = parseConfigText(configPath, content);
    if (!parsed.ok) return parsed;
    return ok(wtConfigSchema.parse(mergeConfig(config, parsed.value)));
  } catch (error) {
    return err(
      new Error(
        `Failed to read ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

export const saveConfig = (
  repoRoot: string,
  config: WtConfig,
): Result<void, Error> => {
  const configPath = join(repoRoot, CONFIG_FILENAME);

  try {
    const validated = wtConfigSchema.parse(config);
    writeFileSync(configPath, `${JSON.stringify(validated, null, 2)}\n`);
    return ok(undefined);
  } catch (error) {
    return err(
      new Error(
        `Failed to save ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

export const configExists = (repoRoot: string): boolean => {
  return existsSync(join(repoRoot, CONFIG_FILENAME));
};

export const addToGitignore = (
  repoRoot: string,
  entry: string,
): Result<void, Error> => {
  const gitignorePath = join(repoRoot, ".gitignore");

  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (content.includes(entry)) {
        return ok(undefined);
      }
      const suffix = content.endsWith("\n") ? "" : "\n";
      appendFileSync(gitignorePath, `${suffix}${entry}\n`);
    } else {
      writeFileSync(gitignorePath, `${entry}\n`);
    }
    return ok(undefined);
  } catch (error) {
    return err(
      new Error(
        `Failed to update .gitignore: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};
