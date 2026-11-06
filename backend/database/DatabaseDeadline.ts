/**
 * Settles with `work`, or with `onTimeout` after `milliseconds`; the timer never outlives it.
 *
 * @param work - The awaited work; it goes on after the deadline.
 * @param milliseconds - Longest wait.
 * @param onTimeout - Supplies the result once the wait ended.
 * @returns The first of both results.
 */
export async function withDeadline<Result>(
  work: Promise<Result>,
  milliseconds: number,
  onTimeout: () => Result,
): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<Result>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, milliseconds);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
