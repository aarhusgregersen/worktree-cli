export type Result<T, E extends Error = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

export const err = <E extends Error>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export const unwrap = <T>(result: Result<T, Error>): T => {
  if (result.ok) return result.value;
  throw result.error;
};

export const mapResult = <T, U, E extends Error>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => {
  if (result.ok) return ok(fn(result.value));
  return result;
};
