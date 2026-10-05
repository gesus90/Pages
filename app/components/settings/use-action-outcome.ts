import { useActionData } from "react-router";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

/**
 * Resolves the kind of `actionData` that belongs to a submitted intent.
 *
 * @param intent - The intent whose outcome the caller wants.
 * @returns The latest outcome of that intent, or `null` when the last
 * submission was another one.
 */
export function useActionOutcome<TIntent extends SettingsActionData["intent"]>(
  intent: TIntent,
): Extract<SettingsActionData, { intent: TIntent }> | null {
  const actionData = useActionData<SettingsActionData | null>();

  if (actionData?.intent !== intent) {
    return null;
  }

  return actionData as Extract<SettingsActionData, { intent: TIntent }>;
}
