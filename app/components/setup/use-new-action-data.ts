import { useState } from "react";

/**
 * Runs a handler once for every new result of a fetcher.
 *
 * @param actionData - Latest result, `undefined` before the first one.
 * @param handle - Receives each new result; it may update state of the
 * same component.
 *
 * @remarks
 * Uses the render-time state update React recommends for reacting to a
 * changed value, so no effect and no extra render cycle is needed.
 */
export function useNewActionData<Data>(
  actionData: Data | undefined,
  handle: (actionData: Data) => void,
): void {
  const [handledData, setHandledData] = useState(actionData);

  if (actionData !== handledData) {
    setHandledData(actionData);

    if (actionData !== undefined) {
      handle(actionData);
    }
  }
}
