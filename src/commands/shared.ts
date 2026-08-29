import { type CliReporter, fail, unwrapCli } from "../cliRuntime.js";
import { loadConfig } from "../config/loader.js";
import type { WtConfig } from "../config/schema.js";
import { ErrorCode } from "../core/errors.js";
import { getGitRoot, isGitRepository } from "../core/git.js";
import {
  type WorktreeInfo,
  findWorktree,
  listWorktrees,
} from "../core/worktree.js";
import { selectWorktree } from "../prompts/interactive.js";

export const requireGitRepository = (): void => {
  if (!isGitRepository()) {
    fail("Not a git repository", { code: ErrorCode.NOT_GIT_REPOSITORY });
  }
};

export const requireWorktrees = async (): Promise<readonly WorktreeInfo[]> =>
  unwrapCli(await listWorktrees());

export const resolveWorktreeTarget = async (options: {
  readonly worktrees: readonly WorktreeInfo[];
  readonly identifier?: string;
  readonly reporter: CliReporter;
}): Promise<WorktreeInfo> => {
  if (!options.identifier) {
    if (!options.reporter.interactive) {
      return fail("Worktree identifier required in --json mode", {
        code: ErrorCode.IDENTIFIER_REQUIRED,
      });
    }
    return selectWorktree(options.worktrees);
  }

  const worktree = findWorktree(options.worktrees, options.identifier);
  if (!worktree) {
    return fail(`Worktree not found: ${options.identifier}`, {
      code: ErrorCode.WORKTREE_NOT_FOUND,
    });
  }
  return worktree;
};

export const requireRepoRoot = async (): Promise<string> =>
  unwrapCli(await getGitRoot());

export const requireConfig = (repoRoot: string): WtConfig => {
  const result = loadConfig(repoRoot);
  if (result.ok) return result.value;
  return fail(result.error.message, {
    code: ErrorCode.INVALID_CONFIG,
    cause: result.error,
  });
};
