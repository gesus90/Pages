import { codexWindowLength } from "@/definition/CodexQuota";

import type { TFunction } from "i18next";

/**
 * The name of a Codex window as a card shows it.
 * @param durationMinutes - The reported length of the window, `null` when none.
 * @param t - Translation of the interface.
 * @returns "5 Stunden" for 300 and "7 Tage" for 10080 minutes, otherwise the
 * length in whole days, hours or minutes; "Kontingentfenster" without a length.
 */
export function codexWindowLabel(
  durationMinutes: number | null,
  t: TFunction,
): string {
  const length = codexWindowLength(durationMinutes);
  switch (length.kind) {
    case "five_hour":
    case "seven_day":
      return t(`agentsPage.window.${length.kind}`);
    case "unknown":
      return t("agentsPage.codex.window.unknown");
    case "days":
    case "hours":
    case "minutes":
      return t(`agentsPage.codex.window.${length.kind}`, {
        count: length.count,
      });
  }
}
