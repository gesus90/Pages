function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shareArray(
  previous: readonly unknown[],
  next: readonly unknown[],
): unknown {
  const shared = next.map((item, index) => shareValue(previous[index], item));
  const isUnchanged =
    previous.length === next.length &&
    shared.every((item, index) => item === previous[index]);
  return isUnchanged ? previous : shared;
}

function shareRecord(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): unknown {
  const keys = Object.keys(next);
  const shared: Record<string, unknown> = {};
  for (const key of keys) shared[key] = shareValue(previous[key], next[key]);
  const isUnchanged =
    Object.keys(previous).length === keys.length &&
    keys.every((key) => key in previous && shared[key] === previous[key]);
  return isUnchanged ? previous : shared;
}

function shareValue(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next))
    return shareArray(previous, next);
  if (isPlainRecord(previous) && isPlainRecord(next))
    return shareRecord(previous, next);
  return next;
}

/**
 * Takes a new answer over from a shown one so that only what really changed gets a new identity.
 * @remarks
 * Every object and array of the new answer that equals its counterpart in
 * the shown answer is replaced by that counterpart, and an answer that
 * equals the shown one as a whole is the shown one. Components and effects
 * that depend on unchanged parts therefore see no change when a route reads
 * its data again behind a shown answer. Only plain objects and arrays are
 * compared; any other value is taken from the new answer.
 * @param previous - The answer shown so far.
 * @param next - The new answer of the same shape.
 * @returns The new answer, sharing every unchanged part with the shown one.
 */
export function shareUnchanged<T>(previous: T, next: T): T {
  // The result is either `previous` or `next` with some of its parts swapped
  // for equal parts of `previous`, so it keeps the shape of `T`.
  return shareValue(previous, next) as T;
}
