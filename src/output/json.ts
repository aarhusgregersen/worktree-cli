import type { ErrorCode } from "../core/errors.js";

export const printJson = <T>(data: T): void => {
  console.log(JSON.stringify(data, null, 2));
};

export const printJsonError = (message: string, code?: ErrorCode): never => {
  console.error(
    JSON.stringify(
      code ? { error: message, code } : { error: message },
      null,
      2,
    ),
  );
  process.exit(1);
};
