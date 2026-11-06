import type { ShouldRevalidateFunctionArgs } from "react-router";

let runningCount = 0;

/**
 * Reads the open page again after a live notice or a reconnect.
 *
 * @remarks
 * Some routes skip a revalidation of the same address, because their own
 * actions already replaced what changed. A live notice comes from another
 * page, so while it runs they load again; see {@link isLiveRevalidation}.
 */
export async function revalidateLive(
  revalidate: () => Promise<void>,
): Promise<void> {
  runningCount += 1;
  try {
    await revalidate();
  } finally {
    runningCount -= 1;
  }
}

/** Whether a revalidation of the same address was started by a live notice. */
export function isLiveRevalidation(
  args: ShouldRevalidateFunctionArgs,
): boolean {
  return (
    runningCount > 0 &&
    args.formMethod === undefined &&
    args.currentUrl.href === args.nextUrl.href
  );
}
