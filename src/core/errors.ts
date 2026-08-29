export const ErrorCode = {
  NOT_GIT_REPOSITORY: "NOT_GIT_REPOSITORY",
  NOT_INITIALIZED: "NOT_INITIALIZED",
  WORKTREE_NOT_FOUND: "WORKTREE_NOT_FOUND",
  BRANCH_EXISTS: "BRANCH_EXISTS",
  BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",
  CANNOT_REMOVE_MAIN: "CANNOT_REMOVE_MAIN",
  WORKTREE_LOCKED: "WORKTREE_LOCKED",
  GH_NOT_AVAILABLE: "GH_NOT_AVAILABLE",
  INSIDE_WORKTREE: "INSIDE_WORKTREE",
  NOT_INSIDE_WORKTREE: "NOT_INSIDE_WORKTREE",
  EXEC_FAILED: "EXEC_FAILED",
  SYNC_FAILED: "SYNC_FAILED",
  IDENTIFIER_REQUIRED: "IDENTIFIER_REQUIRED",
  INVALID_CONFIG: "INVALID_CONFIG",
  DATABASE_CLONE_FAILED: "DATABASE_CLONE_FAILED",
  DATABASE_DROP_FAILED: "DATABASE_DROP_FAILED",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class CliError extends Error {
  readonly code?: ErrorCode;
  readonly exitCode: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    options?: {
      code?: ErrorCode;
      exitCode?: number;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "CliError";
    this.code = options?.code;
    this.exitCode = options?.exitCode ?? 1;
    this.details = options?.details;
  }
}

export class CliCancelled extends Error {
  constructor(message = "Operation cancelled.") {
    super(message);
    this.name = "CliCancelled";
  }
}
