import { describe, expect, it } from "vitest";
import { createAddCommand } from "../../src/commands/add.js";
import { createCdCommand } from "../../src/commands/cd.js";
import { createCleanCommand } from "../../src/commands/clean.js";
import { createCompletionsCommand } from "../../src/commands/completions.js";
import { createCurrentCommand } from "../../src/commands/current.js";
import { createDbCommand } from "../../src/commands/db.js";
import { createDiffCommand } from "../../src/commands/diff.js";
import { createEachCommand } from "../../src/commands/each.js";
import { createExecCommand } from "../../src/commands/exec.js";
import { createInitCommand } from "../../src/commands/init.js";
import { createListCommand } from "../../src/commands/list.js";
import { createOpenCommand } from "../../src/commands/open.js";
import { createPrCommand } from "../../src/commands/pr.js";
import { createRemoveCommand } from "../../src/commands/remove.js";
import { createStatusCommand } from "../../src/commands/status.js";
import { createSyncCommand } from "../../src/commands/sync.js";
import { createProgram } from "../../src/program.js";

describe("command factories", () => {
  it("creates every command family without singleton state", () => {
    const factories = [
      ["add", createAddCommand],
      ["cd", createCdCommand],
      ["clean", createCleanCommand],
      ["completions", createCompletionsCommand],
      ["current", createCurrentCommand],
      ["db", createDbCommand],
      ["diff", createDiffCommand],
      ["each", createEachCommand],
      ["exec", createExecCommand],
      ["init", createInitCommand],
      ["list", createListCommand],
      ["open", createOpenCommand],
      ["pr", createPrCommand],
      ["remove", createRemoveCommand],
      ["status", createStatusCommand],
      ["sync", createSyncCommand],
    ] as const;

    for (const [name, factory] of factories) {
      const first = factory();
      const second = factory();
      expect(first.name()).toBe(name);
      expect(second).not.toBe(first);
    }
  });

  it("assembles every command into a fresh CLI program", () => {
    const first = createProgram();
    const second = createProgram();
    expect(first.commands.map((command) => command.name())).toEqual([
      "init",
      "add",
      "list",
      "remove",
      "open",
      "status",
      "diff",
      "pr",
      "clean",
      "current",
      "db",
      "cd",
      "exec",
      "each",
      "sync",
      "completions",
    ]);
    expect(second).not.toBe(first);
  });
});
