import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { action } from "@/app/routes/tasks";

/** A template action started from a form of its own, with the failure it ended in. */
interface TemplateFetcher {
  readonly fetcher: ReturnType<typeof useFetcher<typeof action>>;
  readonly error: string | null;
}

/**
 * Submits a template action without leaving the page and reports its outcome.
 *
 * @param intent - The action this fetcher is for.
 * @param onSucceeded - Called once after the action succeeded.
 */
export function useTemplateFetcher(
  intent: string,
  onSucceeded: () => void,
): TemplateFetcher {
  const fetcher = useFetcher<typeof action>();
  const handled = useRef(fetcher.data);
  const result = fetcher.data;

  useEffect(() => {
    if (result === handled.current) {
      return;
    }

    handled.current = result;

    if (result?.ok && result.intent === intent) {
      onSucceeded();
    }
  }, [result, intent, onSucceeded]);

  return {
    error:
      result && !result.ok && result.intent === intent ? result.error : null,
    fetcher,
  };
}
