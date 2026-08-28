import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const WORKTREE_DIR_ENV = "WTR_WORKTREE_DIR";

export type WorktreeRootSource = "env" | "config" | "conductor" | "sibling";

export interface ResolvedWorktreeRoot {
  readonly path: string;
  readonly source: WorktreeRootSource;
}

export interface ResolveWorktreeRootOptions {
  readonly mainWorktreePath: string;
  readonly configured?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

const expandHome = (path: string): string => {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
};

// Git reports canonical paths, so anything compared against a worktree list has
// to be canonical too — /var and /tmp are symlinks on macOS. Resolves the
// deepest existing ancestor, since the target directory need not exist yet.
export const canonicalize = (path: string): string => {
  const absolute = resolve(path);
  const missing: string[] = [];
  let current = absolute;

  while (true) {
    try {
      return join(realpathSync(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      missing.unshift(basename(current));
      current = parent;
    }
  }
};

const resolveDir = (value: string, mainWorktreePath: string): string => {
  const expanded = expandHome(value);
  return canonicalize(
    isAbsolute(expanded) ? expanded : resolve(mainWorktreePath, expanded),
  );
};

const conductorRoot = (
  env: NodeJS.ProcessEnv,
  mainWorktreePath: string,
): string | undefined => {
  const workspacePath = env.CONDUCTOR_WORKSPACE_PATH;
  const repoPath = env.CONDUCTOR_ROOT_PATH;
  if (!workspacePath || !repoPath) return undefined;
  if (canonicalize(repoPath) !== canonicalize(mainWorktreePath))
    return undefined;
  return dirname(canonicalize(workspacePath));
};

export const resolveWorktreeRoot = ({
  mainWorktreePath,
  configured,
  env = process.env,
}: ResolveWorktreeRootOptions): ResolvedWorktreeRoot => {
  const fromEnv = env[WORKTREE_DIR_ENV]?.trim();
  if (fromEnv) {
    return { path: resolveDir(fromEnv, mainWorktreePath), source: "env" };
  }

  const fromConfig = configured?.trim();
  if (fromConfig) {
    return { path: resolveDir(fromConfig, mainWorktreePath), source: "config" };
  }

  const fromConductor = conductorRoot(env, mainWorktreePath);
  if (fromConductor) {
    return { path: fromConductor, source: "conductor" };
  }

  return { path: dirname(canonicalize(mainWorktreePath)), source: "sibling" };
};
