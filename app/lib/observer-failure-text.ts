import type { TFunction } from "i18next";
import type { ConversationObserverFailure } from "@/definition/ConversationObserver";

/**
 * Explains why a group observer call gave no result, in the visitor's language (PAGE-340).
 *
 * @param t - The translation function of the component.
 * @param failure - The stored failure; only its stable code is shown.
 * @returns A readable cause; an unknown code is named as it is.
 */
export function observerFailureText(
  t: TFunction,
  failure: Pick<ConversationObserverFailure, "code">,
): string {
  return t(`conversationObserver.code.${failure.code}`, {
    defaultValue: t("conversationObserver.unknownCode", { code: failure.code }),
  });
}
