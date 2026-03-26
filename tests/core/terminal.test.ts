import { describe, expect, it } from "vitest";
import {
  buildClaudeCommand,
  buildWorktreeEnv,
} from "../../src/core/terminal.js";

describe("buildWorktreeEnv", () => {
  it("creates env vars from path and branch", () => {
    const env = buildWorktreeEnv({
      path: "/Users/dev/feature-a",
      branch: "feature-a",
    });

    expect(env).toEqual({
      WT_ACTIVE: "1",
      WT_NAME: "feature-a",
      WT_BRANCH: "feature-a",
      WT_PATH: "/Users/dev/feature-a",
    });
  });

  it("uses last path segment for WT_NAME", () => {
    const env = buildWorktreeEnv({
      path: "/very/deep/nested/my-branch",
      branch: "my-branch",
    });
    expect(env.WT_NAME).toBe("my-branch");
  });

  it("handles undefined branch", () => {
    const env = buildWorktreeEnv({
      path: "/Users/dev/detached",
      branch: undefined,
    });
    expect(env.WT_BRANCH).toBe("");
  });
});

describe("buildClaudeCommand", () => {
  it("returns bare command without plan", () => {
    expect(buildClaudeCommand()).toBe("claude");
  });

  it("returns interactive command with plan as initial prompt", () => {
    const cmd = buildClaudeCommand("/tmp/plan.md");
    expect(cmd).toBe(`claude "$(cat '/tmp/plan.md')"`);;
  });
});
