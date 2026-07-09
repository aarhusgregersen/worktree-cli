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
  it("returns bare command by default", () => {
    expect(buildClaudeCommand()).toBe("claude");
  });

  it("returns bare command with plan when autoMode not set", () => {
    const cmd = buildClaudeCommand({ planPath: "/tmp/plan.md" });
    expect(cmd).toBe(`claude "$(cat '/tmp/plan.md')"`);
  });

  it("returns auto mode command when autoMode is true", () => {
    expect(buildClaudeCommand({ autoMode: true })).toBe("claude --permission-mode auto");
  });

  it("returns auto mode command with plan when autoMode is true", () => {
    const cmd = buildClaudeCommand({ planPath: "/tmp/plan.md", autoMode: true });
    expect(cmd).toBe(`claude --permission-mode auto "$(cat '/tmp/plan.md')"`);
  });

  it("returns bare command when autoMode is false", () => {
    expect(buildClaudeCommand({ autoMode: false })).toBe("claude");
  });

  it("returns command with plan but no auto mode when autoMode is false", () => {
    const cmd = buildClaudeCommand({ planPath: "/tmp/plan.md", autoMode: false });
    expect(cmd).toBe(`claude "$(cat '/tmp/plan.md')"`);
  });

  it("returns command with model flag when model is set", () => {
    expect(buildClaudeCommand({ model: "opus" })).toBe("claude --model 'opus'");
  });

  it("combines model and auto mode flags", () => {
    const cmd = buildClaudeCommand({ model: "haiku", autoMode: true });
    expect(cmd).toBe("claude --permission-mode auto --model 'haiku'");
  });

  it("combines model flag with plan", () => {
    const cmd = buildClaudeCommand({ planPath: "/tmp/plan.md", model: "opus" });
    expect(cmd).toBe(`claude --model 'opus' "$(cat '/tmp/plan.md')"`);
  });
});
