import { vi } from "vitest";

import type { Mock } from "vitest";

/** One facade method together with the aggregate method it must forward to. */
export interface Forwarding<Facade> {
  /** Name of the facade method, used in the test title. */
  readonly facade: string;
  /** Prototype of the aggregate repository that owns the delegate. */
  readonly owner: object;
  /** Name of the delegate method on the aggregate repository. */
  readonly method: string;
  /** Calls the facade method with the arguments of this case. */
  readonly call: (facade: Facade) => Promise<unknown>;
  /** Arguments the delegate must receive. */
  readonly args: readonly unknown[];
}

/** Restores every method replaced by {@link replaceMethod}. */
const restorers: (() => void)[] = [];

/**
 * Replaces a method of an aggregate prototype with a mock that resolves to `result`.
 *
 * @param owner - Prototype that carries the method.
 * @param name - Method name.
 * @param result - Value the replacement resolves to.
 * @returns The replacement, to inspect its calls.
 */
export function replaceMethod(
  owner: object,
  name: string,
  result: unknown,
): Mock {
  const original: unknown = Reflect.get(owner, name);
  if (typeof original !== "function") {
    throw new Error(`${name} is not a method of the aggregate.`);
  }
  const replacement = vi.fn(async () => result);
  Reflect.set(owner, name, replacement);
  restorers.push(() => {
    Reflect.set(owner, name, original);
  });
  return replacement;
}

/** Puts back every method replaced since the last call. */
export function restoreReplacedMethods(): void {
  for (const restore of restorers.splice(0).reverse()) {
    restore();
  }
}
