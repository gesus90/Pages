import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type {
  AutomationPageActionData,
  AutomationPageFailure,
  AutomationPageIntent,
} from "@/definition/AutomationPage";

/** A successful answer of the page's action. */
export type AutomationActionSuccess = Extract<
  AutomationPageActionData,
  { readonly ok: true }
>;

/** A refused change with the intent it belonged to. */
export interface AutomationActionFailure extends AutomationPageFailure {
  readonly intent: AutomationPageIntent;
}

/** What the page reacts to after a change. */
export interface AutomationActionHandlers {
  readonly onSuccess: (result: AutomationActionSuccess) => void;
  readonly onFailure: (failure: AutomationActionFailure) => void;
}

/** Sends the changes of the page and reports how they ended. */
export interface AutomationActions {
  readonly submit: (intent: AutomationPageIntent, payload: object) => void;
  /** The change that is under way, or `null`. */
  readonly busyIntent: AutomationPageIntent | null;
  /** The last refused change until the next one or until it is dismissed. */
  readonly failure: AutomationActionFailure | null;
  readonly dismissFailure: () => void;
}

function isActionData(value: unknown): value is AutomationPageActionData {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "intent" in value &&
    typeof value.intent === "string"
  );
}

function readIntent(
  formData: FormData | undefined,
): AutomationPageIntent | null {
  const intent = formData?.get("intent");
  if (
    intent === "create" ||
    intent === "update" ||
    intent === "setActive" ||
    intent === "run" ||
    intent === "delete"
  )
    return intent;
  return null;
}

/**
 * Posts `intent` and the JSON `payload` to the page's action without
 * leaving the page; React Router then reads the page data again.
 *
 * @param handlers - Called once for every answer.
 */
export function useAutomationActions(
  handlers: AutomationActionHandlers,
): AutomationActions {
  const fetcher = useFetcher();
  const result: unknown = fetcher.data;
  const handled = useRef<unknown>(result);
  const [failure, setFailure] = useState<AutomationActionFailure | null>(null);
  const { onSuccess, onFailure } = handlers;

  useEffect(() => {
    if (fetcher.state !== "idle" || result === handled.current) return;
    handled.current = result;
    if (!isActionData(result)) return;
    if (result.ok) {
      onSuccess(result);
      return;
    }
    const refused = { ...result.error, intent: result.intent };
    setFailure(refused);
    onFailure(refused);
  }, [fetcher.state, result, onSuccess, onFailure]);

  function submit(intent: AutomationPageIntent, payload: object): void {
    setFailure(null);
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("payload", JSON.stringify(payload));
    void fetcher.submit(formData, { method: "post" });
  }

  return {
    submit,
    busyIntent: fetcher.state === "idle" ? null : readIntent(fetcher.formData),
    failure,
    dismissFailure: () => setFailure(null),
  };
}
