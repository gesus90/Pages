import { readRequiredText } from "@/app/lib/form-fields.server";

import { invalidInput, runTaskAction } from "./task-action-support.server";

import type { TaskActionHandler } from "./task-action-support.server";

/** Reads the posted preferences text; anything but JSON is `undefined`. */
function parsePreferences(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A body that is no JSON is invalid input, not a server fault.
    return undefined;
  }
}

/** Saves the board view of the signed-in user: filters, view, sort order and grouping. */
export const handleSaveBoardPreferences: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const text = readRequiredText(formData, "preferences");
  const preferences = text === null ? undefined : parsePreferences(text);

  if (preferences === undefined) {
    return invalidInput("save-board-preferences");
  }

  return runTaskAction("save-board-preferences", () =>
    services.boardPreferencesService.save(actor.id, preferences),
  );
};
