import type { TFunction } from "i18next";

/**
 * Translates a stable chat error code; a code of the agent runner reads as in
 * the agent settings, unknown codes as a general failure.
 */
export function chatErrorText(t: TFunction, code: string): string {
  return t([
    `chat.error.${code}`,
    `settings.agents.error.${code}`,
    "chat.error.general",
  ]);
}
