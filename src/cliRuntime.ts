import { CliCancelled, CliError } from "./core/errors.js";
import { formatError } from "./output/formatter.js";
import { printJson } from "./output/json.js";
import { intro, log, outro, spinner } from "./prompts/interactive.js";
import type { Result } from "./utils/result.js";

export type CliResult<T> = Result<T, CliError>;

export interface ProgressSpinner {
  start(message?: string): void;
  stop(message?: string, code?: number): void;
  message(message?: string): void;
}

export interface CliReporter {
  readonly interactive: boolean;
  intro(message: string): void;
  outro(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  spinner(): ProgressSpinner;
}

const silentSpinner: ProgressSpinner = {
  start: () => undefined,
  stop: () => undefined,
  message: () => undefined,
};

export const createReporter = (json: boolean): CliReporter =>
  json
    ? {
        interactive: false,
        intro: () => undefined,
        outro: () => undefined,
        info: () => undefined,
        success: () => undefined,
        warning: () => undefined,
        error: () => undefined,
        spinner: () => silentSpinner,
      }
    : {
        interactive: true,
        intro,
        outro,
        info: log.info,
        success: log.success,
        warning: log.warning,
        error: log.error,
        spinner,
      };

export const fail = (
  message: string,
  options?: ConstructorParameters<typeof CliError>[1],
): never => {
  throw new CliError(message, options);
};

export const unwrapCli = <T>(
  result: Result<T, Error>,
  options?: ConstructorParameters<typeof CliError>[1],
): T => {
  if (result.ok) return result.value;
  return fail(result.error.message, { ...options, cause: result.error });
};

export const runCliAction = async <T>(options: {
  readonly json: boolean;
  readonly action: (reporter: CliReporter) => Promise<T> | T;
  readonly renderHuman?: (value: T, reporter: CliReporter) => void;
  readonly renderJson?: (value: T) => unknown;
  readonly exitCode?: (value: T) => number;
}): Promise<void> => {
  const reporter = createReporter(options.json);
  try {
    const value = await options.action(reporter);
    if (options.json) printJson(options.renderJson?.(value) ?? value);
    else options.renderHuman?.(value, reporter);
    const exitCode = options.exitCode?.(value) ?? 0;
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof CliCancelled) return;
    const cliError =
      error instanceof CliError
        ? error
        : new CliError(error instanceof Error ? error.message : String(error), {
            cause: error,
          });
    if (options.json) {
      console.error(
        JSON.stringify(
          cliError.code
            ? { error: cliError.message, code: cliError.code }
            : { error: cliError.message },
          null,
          2,
        ),
      );
    } else {
      console.error(formatError(cliError.message));
    }
    process.exitCode = cliError.exitCode;
  }
};
