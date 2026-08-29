import { describe, expect, it } from "vitest";
import { mergeConfig, parseConfigText } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/schema.js";

describe("parseConfigText", () => {
  it("accepts partial nested config", () => {
    const result = parseConfigText(
      "/repo/.wtr.json",
      JSON.stringify({ terminal: { focus: true }, portOffset: 0 }),
    );
    expect(result).toEqual({
      ok: true,
      value: { terminal: { focus: true }, portOffset: 0 },
    });
  });

  it("rejects unknown fields with their path", () => {
    const result = parseConfigText(
      "/repo/.wtr.json",
      JSON.stringify({ terminal: { focuz: true } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("/repo/.wtr.json");
      expect(result.error.message).toContain("terminal");
    }
  });

  it.each([
    [{ portOffset: -1 }, "portOffset"],
    [{ portOffset: 1.5 }, "portOffset"],
    [{ copyFiles: [1] }, "copyFiles.0"],
    [{ worktreeDir: "" }, "worktreeDir"],
    [{ terminal: { mode: "pane" } }, "terminal.mode"],
  ])("rejects invalid config %j", (config, path) => {
    const result = parseConfigText("config.json", JSON.stringify(config));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain(path);
  });
});

describe("mergeConfig", () => {
  it("preserves precedence while merging partial terminal fields", () => {
    const global = mergeConfig(DEFAULT_CONFIG, {
      copyFiles: [".env"],
      terminal: { focus: true },
    });
    const local = mergeConfig(global, {
      portOffset: 200,
      terminal: { mode: "tab" },
    });
    expect(local).toEqual({
      copyFiles: [".env"],
      portOffset: 200,
      portExclusions: [],
      terminal: { mode: "tab", autoMode: false, focus: true },
    });
  });
});
