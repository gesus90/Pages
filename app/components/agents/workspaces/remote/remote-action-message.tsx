import { useTranslation } from "react-i18next";

import { isRemotePathIssue } from "@/definition/RemoteConnection";

import type { TFunction } from "i18next";
import type { RemoteActionResult } from "@/definition/RemoteConnection";

// A refusal can appear below the visible part of a dialog, so it is scrolled into view.
function revealMessage(element: HTMLElement | null): void {
  element?.scrollIntoView({ block: "nearest" });
}

/**
 * A path finding comes from a check that did run over the connection, so it
 * stands alone; a connection failure keeps the sentence of the failed action.
 */
function messageOf(
  result: Extract<RemoteActionResult, { readonly ok: false }>,
  t: TFunction,
): string {
  const { error, failure } = result;
  if (isRemotePathIssue(failure)) return t(`remote.failure.${failure}`);
  const action = t(`remote.error.${error}`);
  return failure ? `${action} ${t(`remote.failure.${failure}`)}` : action;
}

/** Shows a failed remote action with its translated cause; native SSH text never reaches it. */
export function RemoteActionMessage({
  result,
}: {
  readonly result: RemoteActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!result || result.ok) return null;
  return (
    <p ref={revealMessage} role="alert" className="text-sm text-destructive">
      {messageOf(result, t)}
    </p>
  );
}
