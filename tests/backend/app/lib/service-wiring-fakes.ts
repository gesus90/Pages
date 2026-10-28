import { isDeepStrictEqual } from "node:util";

import { vi } from "vitest";

import type { Mock } from "vitest";

/**
 * A recording stand-in for a constructed class.
 *
 * @remarks
 * `mock.calls` holds the constructor arguments and `mock.instances` the
 * created objects. Each instance also keeps its arguments as
 * `constructedWith`, so two instances built from different collaborators are
 * not deep-equal.
 */
export type FakeClass = Mock<(...args: unknown[]) => void>;

/** Prototype method names of the faked classes of one module, by exported class name. */
export type FakeClassMethods = Readonly<Record<string, readonly string[]>>;

/**
 * Creates a stand-in class whose prototype methods are shared mocks.
 *
 * @param methods - Prototype methods the code under test calls.
 * @returns The recording class.
 *
 * @remarks
 * A shared prototype mock lets a test choose the answer of an instance that
 * the code under test constructs itself, before it exists.
 */
export function fakeClass(methods: readonly string[] = []): FakeClass {
  const fake: FakeClass = vi.fn(function constructFake(
    this: unknown,
    ...args: unknown[]
  ): void {
    Reflect.set(Object(this), "constructedWith", args);
  });
  const prototype: unknown = fake.prototype;
  for (const method of methods) Reflect.set(Object(prototype), method, vi.fn());
  return fake;
}

/**
 * Creates the exports of a mocked module that only exports classes.
 *
 * @param classes - The class names with the prototype methods each needs.
 * @returns The module exports for a `vi.mock` factory.
 */
export function fakeClasses(
  classes: FakeClassMethods,
): Record<string, FakeClass> {
  return Object.fromEntries(
    Object.entries(classes).map(([name, methods]) => [
      name,
      fakeClass(methods),
    ]),
  );
}

/**
 * Creates a distinct collaborator that the code under test only passes along.
 *
 * @param name - Name that tells stand-ins apart in deep comparisons.
 * @returns An object with only that name, typed as the collaborator.
 */
export function opaque<T>(name: string): T {
  const marker: unknown = { opaque: name };
  return marker as T;
}

/**
 * Types a collaborator that only has the members the code under test uses.
 *
 * @param members - The members of the stand-in.
 * @returns The same object, typed as the collaborator.
 */
export function partial<T>(members: object): T {
  const stand: unknown = members;
  return stand as T;
}

/** The recorded constructions of a fake class, as `vi.mocked` exposes them. */
export interface RecordedConstructions<Instance> {
  readonly mock: {
    readonly calls: readonly (readonly unknown[])[];
    readonly instances: readonly Instance[];
  };
}

/**
 * Finds the one instance a fake class created with exactly these arguments.
 *
 * @param fake - The mocked class.
 * @param args - The expected constructor arguments.
 * @returns The instance; a test fails when none or several match.
 */
export function instanceBuiltWith<Instance>(
  fake: RecordedConstructions<Instance>,
  ...args: readonly unknown[]
): Instance {
  const matches = fake.mock.instances.filter((_, index) =>
    isDeepStrictEqual(fake.mock.calls[index], args),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one construction with these arguments, found ${matches.length}.`,
    );
  }
  return matches[0];
}
