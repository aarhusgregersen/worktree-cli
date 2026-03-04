import { describe, expect, it } from "vitest";
import {
  findWorktree,
  isInsideWorktree,
  parseWorktreeEntry,
  parseWorktreeOutput,
  parsePruneOutput,
} from "../../src/core/worktree.js";

describe("parseWorktreeOutput", () => {
  it("parses multiple worktree entries", () => {
    const output = [
      "worktree /Users/dev/project",
      "HEAD abc1234567890abcdef1234567890abcdef123456",
      "branch refs/heads/main",
      "",
      "worktree /Users/dev/feature-a",
      "HEAD def4567890abcdef1234567890abcdef12345678",
      "branch refs/heads/feature-a",
      "",
    ].join("\n");

    const result = parseWorktreeOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      path: "/Users/dev/project",
      head: "abc1234567890abcdef1234567890abcdef123456",
      branch: "main",
      isLocked: false,
      isPrunable: false,
      isMain: true,
      isDetached: false,
    });
    expect(result[1]).toEqual({
      path: "/Users/dev/feature-a",
      head: "def4567890abcdef1234567890abcdef12345678",
      branch: "feature-a",
      isLocked: false,
      isPrunable: false,
      isMain: false,
      isDetached: false,
    });
  });

  it("returns empty array for empty output", () => {
    expect(parseWorktreeOutput("")).toHaveLength(0);
  });
});

describe("parseWorktreeEntry", () => {
  it("parses a basic entry", () => {
    const entry = [
      "worktree /Users/dev/project",
      "HEAD abc1234567890abcdef1234567890abcdef123456",
      "branch refs/heads/main",
    ].join("\n");

    const result = parseWorktreeEntry(entry, true);
    expect(result.path).toBe("/Users/dev/project");
    expect(result.head).toBe("abc1234567890abcdef1234567890abcdef123456");
    expect(result.branch).toBe("main");
    expect(result.isMain).toBe(true);
    expect(result.isLocked).toBe(false);
    expect(result.isPrunable).toBe(false);
    expect(result.isDetached).toBe(false);
  });

  it("parses a locked entry", () => {
    const entry = [
      "worktree /Users/dev/feature",
      "HEAD abc1234567890abcdef1234567890abcdef123456",
      "branch refs/heads/feature",
      "locked",
    ].join("\n");

    const result = parseWorktreeEntry(entry, false);
    expect(result.isLocked).toBe(true);
  });

  it("parses a prunable entry", () => {
    const entry = [
      "worktree /Users/dev/stale",
      "HEAD abc1234567890abcdef1234567890abcdef123456",
      "branch refs/heads/stale",
      "prunable",
    ].join("\n");

    const result = parseWorktreeEntry(entry, false);
    expect(result.isPrunable).toBe(true);
  });

  it("parses a detached entry", () => {
    const entry = [
      "worktree /Users/dev/detached",
      "HEAD abc1234567890abcdef1234567890abcdef123456",
      "detached",
    ].join("\n");

    const result = parseWorktreeEntry(entry, false);
    expect(result.isDetached).toBe(true);
    expect(result.branch).toBeUndefined();
  });
});

describe("parsePruneOutput", () => {
  it("extracts worktree names from prune output", () => {
    const output = [
      "Removing worktrees/feature-a: not a valid directory",
      "Removing worktrees/feature-b: gitdir points to non-existent location",
    ].join("\n");

    const result = parsePruneOutput(output);
    // The regex captures \S+ after worktrees/ which includes the trailing colon
    expect(result).toEqual(["feature-a:", "feature-b:"]);
  });

  it("handles Pruning prefix", () => {
    const output = "Pruning worktrees/old-branch: not a valid directory\n";
    const result = parsePruneOutput(output);
    expect(result).toEqual(["old-branch:"]);
  });

  it("returns empty array for empty output", () => {
    expect(parsePruneOutput("")).toEqual([]);
  });

  it("ignores non-matching lines", () => {
    const output = "Some random output\nAnother line\n";
    expect(parsePruneOutput(output)).toEqual([]);
  });
});

describe("findWorktree", () => {
  const worktrees = [
    {
      path: "/Users/dev/project",
      head: "abc1234",
      branch: "main",
      isLocked: false,
      isPrunable: false,
      isMain: true,
      isDetached: false,
    },
    {
      path: "/Users/dev/feature-a",
      head: "def5678",
      branch: "feature-a",
      isLocked: false,
      isPrunable: false,
      isMain: false,
      isDetached: false,
    },
    {
      path: "/Users/dev/feature-b",
      head: "ghi9012",
      branch: "feature-b",
      isLocked: false,
      isPrunable: false,
      isMain: false,
      isDetached: false,
    },
  ] as const;

  it("finds by numeric ID (1-indexed, non-main only)", () => {
    const result = findWorktree(worktrees, "1");
    expect(result?.branch).toBe("feature-a");
  });

  it("finds by numeric ID 2", () => {
    const result = findWorktree(worktrees, "2");
    expect(result?.branch).toBe("feature-b");
  });

  it("returns undefined for out of range ID", () => {
    expect(findWorktree(worktrees, "5")).toBeUndefined();
  });

  it("finds by full path", () => {
    const result = findWorktree(worktrees, "/Users/dev/feature-a");
    expect(result?.branch).toBe("feature-a");
  });

  it("finds by directory name", () => {
    const result = findWorktree(worktrees, "feature-b");
    expect(result?.branch).toBe("feature-b");
  });

  it("finds by branch name", () => {
    const result = findWorktree(worktrees, "feature-a");
    expect(result?.branch).toBe("feature-a");
  });

  it("returns undefined when not found", () => {
    expect(findWorktree(worktrees, "nonexistent")).toBeUndefined();
  });
});

describe("isInsideWorktree", () => {
  const worktrees = [
    {
      path: "/Users/dev/project",
      head: "abc1234",
      branch: "main",
      isLocked: false,
      isPrunable: false,
      isMain: true,
      isDetached: false,
    },
    {
      path: "/Users/dev/feature-a",
      head: "def5678",
      branch: "feature-a",
      isLocked: false,
      isPrunable: false,
      isMain: false,
      isDetached: false,
    },
  ] as const;

  it("detects cwd inside a non-main worktree", () => {
    const result = isInsideWorktree(worktrees, "/Users/dev/feature-a");
    expect(result?.branch).toBe("feature-a");
  });

  it("detects cwd in subdirectory of a non-main worktree", () => {
    const result = isInsideWorktree(worktrees, "/Users/dev/feature-a/src/lib");
    expect(result?.branch).toBe("feature-a");
  });

  it("returns undefined for main worktree", () => {
    const result = isInsideWorktree(worktrees, "/Users/dev/project");
    expect(result).toBeUndefined();
  });

  it("returns undefined for unrelated path", () => {
    const result = isInsideWorktree(worktrees, "/Users/other/path");
    expect(result).toBeUndefined();
  });
});
