import { describe, expect, it, vi } from "vitest";
import {
  type LaunchDependencies,
  executeLaunchSpec,
  prepareLaunchSpec,
} from "../../src/core/launch.js";

const dependencies = (): LaunchDependencies => ({
  resolvePlanText: vi.fn(async () => "the plan"),
  writePlanToTempFile: vi.fn(() => "/tmp/plan.md"),
  buildClaudeCommand: vi.fn(
    ({ planPath, autoMode, model } = {}) =>
      `claude:${planPath}:${String(autoMode)}:${model}`,
  ),
  buildWorktreeEnv: vi.fn(({ path, branch }) => ({
    WT_PATH: path,
    WT_BRANCH: branch ?? "",
  })),
  openTerminalWindow: vi.fn(),
});

describe("launch specs", () => {
  it("uses the same resolved terminal config for previews and execution", async () => {
    const deps = dependencies();
    const spec = await prepareLaunchSpec(
      {
        cwd: "/repo/worktree",
        branch: "feature/test",
        terminal: { mode: "tab", autoMode: true, focus: true },
        startClaude: true,
        plan: "ship it",
        model: "opus",
      },
      deps,
    );

    expect(spec.command).toBe("claude:/tmp/plan.md:true:opus");
    executeLaunchSpec(spec, deps);
    expect(deps.openTerminalWindow).toHaveBeenCalledWith({
      cwd: "/repo/worktree",
      command: spec.command,
      env: { WT_PATH: "/repo/worktree", WT_BRANCH: "feature/test" },
      mode: "tab",
      focus: true,
    });
  });

  it("does not create a Claude command for a plain terminal", async () => {
    const deps = dependencies();
    const spec = await prepareLaunchSpec(
      {
        cwd: "/repo/worktree",
        branch: undefined,
        terminal: { mode: "window", autoMode: false, focus: false },
        startClaude: false,
      },
      deps,
    );
    expect(spec.command).toBeUndefined();
    expect(spec.handoff).toBe(false);
  });
});
