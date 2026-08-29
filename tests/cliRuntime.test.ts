import { afterEach, describe, expect, it, vi } from "vitest";
import { runCliAction } from "../src/cliRuntime.js";
import { CliCancelled, CliError, ErrorCode } from "../src/core/errors.js";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("runCliAction", () => {
  it("serializes JSON results without exiting the process", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit");
    await runCliAction({ json: true, action: () => ({ value: 42 }) });
    expect(log).toHaveBeenCalledWith('{\n  "value": 42\n}');
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("renders typed JSON errors and sets exitCode centrally", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await runCliAction({
      json: true,
      action: () => {
        throw new CliError("bad config", {
          code: ErrorCode.INVALID_CONFIG,
        });
      },
    });
    expect(error).toHaveBeenCalledWith(
      '{\n  "error": "bad config",\n  "code": "INVALID_CONFIG"\n}',
    );
    expect(process.exitCode).toBe(1);
  });

  it("treats cancellation as a successful return", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await runCliAction({
      json: false,
      action: () => {
        throw new CliCancelled();
      },
    });
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
