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
  GLOBAL_CONFIG_PATH,
  type WtConfig,
} from "./schema.js";

export const loadGlobalConfig = (): Result<Partial<WtConfig>, Error> => {
  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    return ok({});
  }

  try {
    const content = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
    return ok(JSON.parse(content) as Partial<WtConfig>);
  } catch (error) {
    return err(
      new Error(
        `Failed to parse global config (~/.wt/config.json): ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
};

export const globalConfigExists = (): boolean => {
  return existsSync(GLOBAL_CONFIG_PATH);
};

const mergeConfig = (
  base: WtConfig,
  override: Partial<WtConfig>,
): WtConfig => ({
  copyFiles: override.copyFiles ?? base.copyFiles,
  portOffset: override.portOffset ?? base.portOffset,
  portExclusions: override.portExclusions ?? base.portExclusions,
});

export const loadConfig = (repoRoot: string): Result<WtConfig, Error> => {
  // Start with defaults
  let config: WtConfig = { ...DEFAULT_CONFIG };

  // Merge global config
  const globalResult = loadGlobalConfig();
  if (globalResult.ok) {
    config = mergeConfig(config, globalResult.value);
  } else {
    // Warn but continue — global config is a convenience
    console.warn(globalResult.error.message);
  }

  // Merge local config
  const configPath = join(repoRoot, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return ok(config);
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<WtConfig>;
    return ok(mergeConfig(config, parsed));
  } catch (error) {
    return err(
      new Error(
        `Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
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
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
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
