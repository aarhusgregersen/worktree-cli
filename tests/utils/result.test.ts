import { describe, expect, it } from "vitest";
import { err, mapResult, ok, unwrap } from "../../src/utils/result.js";

describe("ok", () => {
  it("creates a success result", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  it("works with string values", () => {
    const result = ok("hello");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("hello");
  });
});

describe("err", () => {
  it("creates an error result", () => {
    const result = err(new Error("failed"));
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("failed");
  });
});

describe("unwrap", () => {
  it("returns value for ok result", () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it("throws for err result", () => {
    expect(() => unwrap(err(new Error("boom")))).toThrow("boom");
  });
});

describe("mapResult", () => {
  it("transforms value for ok result", () => {
    const result = mapResult(ok(5), (n) => n * 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(10);
  });

  it("passes through error result", () => {
    const error = new Error("failed");
    const result = mapResult(err(error), (n: number) => n * 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(error);
  });
});
