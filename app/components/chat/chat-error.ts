import type { TFunction } from "i18next";

/** Translates a stable chat error code; unknown codes read as a general failure. */
export function chatErrorText(t: TFunction, code: string): string {
  return t([`chat.error.${code}`, "chat.error.general"]);
}
