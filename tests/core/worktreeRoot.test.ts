import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { resolveWorktreeRoot } from "../../src/core/worktreeRoot.js";

const MAIN = "/repos/acme/app";

describe("resolveWorktreeRoot", () => {
  it("defaults to the main worktree's parent directory", () => {
    expect(resolveWorktreeRoot({ mainWorktreePath: MAIN, env: {} })).toEqual({
      path: "/repos/acme",
      source: "sibling",
    });
  });

  it("uses Conductor's workspace directory when the repo matches", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      env: {
        CONDUCTOR_ROOT_PATH: MAIN,
        CONDUCTOR_WORKSPACE_PATH: "/conductor/workspaces/app/hong-kong",
      },
    });

    expect(result).toEqual({
      path: "/conductor/workspaces/app",
      source: "conductor",
    });
  });

  it("ignores Conductor when its repo is a different one", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      env: {
        CONDUCTOR_ROOT_PATH: "/repos/acme/other",
        CONDUCTOR_WORKSPACE_PATH: "/conductor/workspaces/other/hong-kong",
      },
    });

    expect(result.source).toBe("sibling");
  });

  it("ignores Conductor when the workspace path is missing", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      env: { CONDUCTOR_ROOT_PATH: MAIN },
    });

    expect(result.source).toBe("sibling");
  });

  it("prefers the configured directory over Conductor", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      configured: "/work/trees",
      env: {
        CONDUCTOR_ROOT_PATH: MAIN,
        CONDUCTOR_WORKSPACE_PATH: "/conductor/workspaces/app/hong-kong",
      },
    });

    expect(result).toEqual({ path: "/work/trees", source: "config" });
  });

  it("prefers the env override over config", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      configured: "/work/trees",
      env: { WTR_WORKTREE_DIR: "/env/trees" },
    });

    expect(result).toEqual({ path: "/env/trees", source: "env" });
  });

  it("expands ~ in configured directories", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      configured: "~/worktrees",
      env: {},
    });

    expect(result.path).toBe(`${homedir()}/worktrees`);
  });

  it("resolves relative directories against the main worktree", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      configured: "../trees",
      env: {},
    });

    expect(result.path).toBe("/repos/acme/trees");
  });

  it("canonicalizes symlinked paths so they can be compared with git's", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      configured: "/tmp/trees",
      env: {},
    });

    expect(result.path).toBe(`${realpathSync("/tmp")}/trees`);
  });

  it("ignores blank values", () => {
    const result = resolveWorktreeRoot({
      mainWorktreePath: MAIN,
      configured: "  ",
      env: { WTR_WORKTREE_DIR: "" },
    });

    expect(result.source).toBe("sibling");
  });
});
