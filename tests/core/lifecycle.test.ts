import { describe, expect, it, vi } from "vitest";
import {
  type LifecycleDependencies,
  cloneDatabaseForWorktree,
  defaultLifecycleDependencies,
  removeManagedWorktree,
  removeManagedWorktrees,
} from "../../src/core/lifecycle.js";
import type { WorktreeInfo } from "../../src/core/worktree.js";
import { err, ok } from "../../src/utils/result.js";

const worktree: WorktreeInfo = {
  path: "/repo/feature",
  head: "abc",
  branch: "feature/test",
  isLocked: false,
  isPrunable: false,
  isMain: false,
  isDetached: false,
};

const dependencies = (): LifecycleDependencies => ({
  ...defaultLifecycleDependencies,
  readEnvFiles: vi.fn(() => []),
  findDatabaseUrl: vi.fn(() => ({
    file: ".env",
    key: "DATABASE_URL",
    url: "postgres://localhost/template",
  })),
  ensureWorktreeEnv: vi.fn(() => ok(true)),
  createDatabase: vi.fn(() => ok("template_wtr_feature_test")),
  updateDatabaseUrlInEnvFiles: vi.fn(() => ok([".env"])),
  writeWorktreeDb: vi.fn(() => ok(undefined)),
  restoreEnvDirectory: vi.fn(() => ok(undefined)),
  removeWorktreeDb: vi.fn(() => ok(undefined)),
  dropDatabase: vi.fn(() => ok(undefined)),
  readWorktreeDb: vi.fn(() => "template_wtr_feature_test"),
  getMainWorktreePath: vi.fn(async () => ok("/repo/main")),
  removeWorktree: vi.fn(async () => ok(undefined)),
});

describe("cloneDatabaseForWorktree", () => {
  it("owns the full successful provisioning workflow", () => {
    const deps = dependencies();
    const result = cloneDatabaseForWorktree(
      {
        worktreePath: worktree.path,
        mainPath: "/repo/main",
        branch: worktree.branch ?? "",
      },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        name: "template_wtr_feature_test",
        template: "template",
        updatedFiles: [".env"],
        copiedEnvFile: true,
      },
    });
    expect(deps.writeWorktreeDb).toHaveBeenCalledWith(
      worktree.path,
      "template_wtr_feature_test",
    );
  });

  it("restores env and drops the database when a post-create step fails", () => {
    const deps = dependencies();
    vi.mocked(deps.updateDatabaseUrlInEnvFiles).mockReturnValue(
      err(new Error("write failed")),
    );
    const result = cloneDatabaseForWorktree(
      {
        worktreePath: worktree.path,
        mainPath: "/repo/main",
        branch: worktree.branch ?? "",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.restoreEnvDirectory).toHaveBeenCalled();
    expect(deps.dropDatabase).toHaveBeenCalledWith(
      "template_wtr_feature_test",
      expect.any(Object),
    );
  });

  it("reports an orphan when rollback cannot drop the database", () => {
    const deps = dependencies();
    vi.mocked(deps.writeWorktreeDb).mockReturnValue(
      err(new Error("marker failed")),
    );
    vi.mocked(deps.dropDatabase).mockReturnValue(err(new Error("drop failed")));
    const result = cloneDatabaseForWorktree(
      {
        worktreePath: worktree.path,
        mainPath: "/repo/main",
        branch: worktree.branch ?? "",
      },
      deps,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details?.orphaned).toBe(true);
  });
});

describe("removeManagedWorktree", () => {
  it("preserves the worktree when database cleanup fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.dropDatabase).mockReturnValue(
      err(new Error("database busy")),
    );
    const result = await removeManagedWorktree(
      { worktree, force: false },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.removeWorktree).not.toHaveBeenCalled();
    expect(deps.removeWorktreeDb).not.toHaveBeenCalled();
  });

  it("allows force removal and reports the orphan database", async () => {
    const deps = dependencies();
    vi.mocked(deps.dropDatabase).mockReturnValue(
      err(new Error("database busy")),
    );
    const result = await removeManagedWorktree({ worktree, force: true }, deps);
    expect(result).toEqual({
      ok: true,
      value: {
        path: worktree.path,
        branch: worktree.branch,
        removed: true,
        database: "template_wtr_feature_test",
        databaseDropped: false,
        orphanedDatabase: "template_wtr_feature_test",
      },
    });
  });

  it("continues a batch after an individual removal fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.readWorktreeDb).mockReturnValue(undefined);
    vi.mocked(deps.removeWorktree).mockImplementation(async ({ path }) =>
      path.endsWith("/failed")
        ? err(new Error("remove failed"))
        : ok(undefined),
    );
    const failed = { ...worktree, path: "/repo/failed", branch: "failed" };
    const succeeded = {
      ...worktree,
      path: "/repo/succeeded",
      branch: "succeeded",
    };
    const results = await removeManagedWorktrees(
      [failed, succeeded],
      false,
      deps,
    );
    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(deps.removeWorktree).toHaveBeenCalledTimes(2);
  });
});
