import { homedir } from "node:os";
import { join } from "node:path";

const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

const xdgCacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");

// XDG-conformant paths (preferred). Legacy ~/.wt kept as a read fallback so
// existing setups keep working.
export const GLOBAL_CONFIG_DIR = join(xdgConfigHome, "wtr");
export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");
export const LEGACY_GLOBAL_CONFIG_PATH = join(homedir(), ".wt", "config.json");

export const GLOBAL_CACHE_DIR = join(xdgCacheHome, "wtr");

// Persistent cache of branches known to be merged (see core/mergeCache.ts).
export const GLOBAL_CACHE_PATH = join(GLOBAL_CACHE_DIR, "merged.json");

// Marker written after the first-run welcome banner is shown, so it only
// appears once. Regenerable state, so it lives in the XDG cache dir.
export const WELCOME_MARKER_PATH = join(GLOBAL_CACHE_DIR, ".welcomed");

export type TerminalMode = "window" | "tab";

export interface TerminalConfig {
  readonly mode: TerminalMode;
  readonly autoMode: boolean;
  readonly focus: boolean;
}

export interface WtConfig {
  readonly copyFiles: readonly string[];
  readonly portOffset: number;
  readonly portExclusions: readonly string[];
  readonly terminal: TerminalConfig;
}

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  mode: "window",
  autoMode: false,
  focus: false,
};

export const DEFAULT_CONFIG: WtConfig = {
  copyFiles: [],
  portOffset: 100,
  portExclusions: [],
  terminal: DEFAULT_TERMINAL_CONFIG,
};

export const DEFAULT_PORT_EXCLUSION_PATTERNS = [
  "DATABASE",
  "DB_PORT",
  "DB_HOST",
  "POSTGRES",
  "PG_",
  "MYSQL",
  "MONGO",
  "REDIS",
  "CACHE",
  "QUEUE",
  "RABBIT",
  "KAFKA",
  "ELASTIC",
  "OPENSEARCH",
  "MEMCACHE",
] as const;

export const isExcludedPort = (
  varName: string,
  exclusions: readonly string[],
): boolean => {
  const upperName = varName.toUpperCase();

  for (const exclusion of exclusions) {
    if (upperName.includes(exclusion.toUpperCase())) {
      return true;
    }
  }

  for (const pattern of DEFAULT_PORT_EXCLUSION_PATTERNS) {
    if (upperName.includes(pattern)) {
      return true;
    }
  }

  return false;
};

export const CONFIG_FILENAME = ".wtr.json";
