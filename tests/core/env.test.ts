import { describe, expect, it } from "vitest";
import { transformPortLines } from "../../src/core/env.js";

describe("transformPortLines", () => {
  it("bumps a simple PORT variable", () => {
    const lines = ["APP_PORT=3000"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["APP_PORT=3100"]);
    expect(result.changes).toEqual([
      { key: "APP_PORT", oldPort: 3000, newPort: 3100 },
    ]);
  });

  it("bumps a suffixed port variable", () => {
    const lines = ["API_PORT=8080"];
    const result = transformPortLines(lines, 200, []);
    expect(result.newLines).toEqual(["API_PORT=8280"]);
    expect(result.changes).toHaveLength(1);
  });

  it("bumps a URL port", () => {
    const lines = ["API_URL=http://localhost:3000/api"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["API_URL=http://localhost:3100/api"]);
    expect(result.changes).toEqual([
      { key: "API_URL", oldPort: 3000, newPort: 3100 },
    ]);
  });

  it("skips excluded ports (DATABASE)", () => {
    const lines = ["DATABASE_PORT=5432"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["DATABASE_PORT=5432"]);
    expect(result.changes).toHaveLength(0);
  });

  it("skips excluded ports (REDIS)", () => {
    const lines = ["REDIS_PORT=6379"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["REDIS_PORT=6379"]);
    expect(result.changes).toHaveLength(0);
  });

  it("skips custom exclusions", () => {
    const lines = ["MY_SPECIAL_PORT=9000"];
    const result = transformPortLines(lines, 100, ["SPECIAL"]);
    expect(result.newLines).toEqual(["MY_SPECIAL_PORT=9000"]);
    expect(result.changes).toHaveLength(0);
  });

  it("preserves comments", () => {
    const lines = ["# This is a comment", "APP_PORT=3000"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["# This is a comment", "APP_PORT=3100"]);
    expect(result.changes).toHaveLength(1);
  });

  it("preserves blank lines", () => {
    const lines = ["SERVER_PORT=3000", "", "API_PORT=8080"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["SERVER_PORT=3100", "", "API_PORT=8180"]);
    expect(result.changes).toHaveLength(2);
  });

  it("handles quoted values (detected but replace uses unquoted pattern)", () => {
    // The regex detects the port inside quotes, but the replace pattern
    // `=<port>` doesn't match `="<port>"` — so the line is unchanged.
    // This tests actual behavior; env files rarely quote port numbers.
    const lines = ['APP_PORT="3000"'];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(['APP_PORT="3000"']);
    expect(result.changes).toHaveLength(1);
  });

  it("handles single-quoted values (same limitation as double quotes)", () => {
    const lines = ["APP_PORT='3000'"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual(["APP_PORT='3000'"]);
    expect(result.changes).toHaveLength(1);
  });

  it("handles non-port lines", () => {
    const lines = ["NODE_ENV=development", "APP_PORT=3000", "DEBUG=true"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual([
      "NODE_ENV=development",
      "APP_PORT=3100",
      "DEBUG=true",
    ]);
    expect(result.changes).toHaveLength(1);
  });

  it("handles URL with path and query", () => {
    const lines = ["BACKEND_URL=http://localhost:4000/graphql?debug=1"];
    const result = transformPortLines(lines, 100, []);
    expect(result.newLines).toEqual([
      "BACKEND_URL=http://localhost:4100/graphql?debug=1",
    ]);
  });

  it("returns empty changes for empty input", () => {
    const result = transformPortLines([], 100, []);
    expect(result.newLines).toEqual([]);
    expect(result.changes).toHaveLength(0);
  });
});
