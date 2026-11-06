/** A promise and the two operations belonging to exactly that promise. */
export interface LocalDeferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (result: T | PromiseLike<T>) => void;
  readonly reject: (error: unknown) => void;
}

/** Creates explicit completion controls without requiring a newer runtime library target. */
export function localDeferred<T>(): LocalDeferred<T> {
  const controls: {
    resolve?: LocalDeferred<T>["resolve"];
    reject?: LocalDeferred<T>["reject"];
  } = {};
  const promise = new Promise<T>((resolve, reject) => {
    controls.resolve = resolve;
    controls.reject = reject;
  });
  const { resolve, reject } = controls;
  if (!resolve || !reject) throw new Error("Promise controls are unavailable");
  return { promise, resolve, reject };
}
