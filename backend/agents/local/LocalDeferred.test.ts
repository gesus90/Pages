import { expect, it } from "vitest";

import { localDeferred } from "@/backend/agents/local/LocalDeferred";

it("resolves the promise through its own controls", async () => {
  const deferred = localDeferred<number>();
  deferred.resolve(7);
  await expect(deferred.promise).resolves.toBe(7);
});

it("rejects the promise through its own controls", async () => {
  const deferred = localDeferred<number>();
  deferred.reject(new Error("failed"));
  await expect(deferred.promise).rejects.toThrow("failed");
});

it("throws when the runtime does not run the promise executor synchronously", () => {
  const OriginalPromise = globalThis.Promise;
  class LazyPromise<T> extends OriginalPromise<T> {
    public constructor(
      executor: (
        resolve: (value: T | PromiseLike<T>) => void,
        reject: (reason?: unknown) => void,
      ) => void,
    ) {
      super(() => undefined);
      void executor;
    }
  }
  globalThis.Promise = LazyPromise;
  try {
    expect(() => localDeferred<number>()).toThrow(
      "Promise controls are unavailable",
    );
  } finally {
    globalThis.Promise = OriginalPromise;
  }
});
