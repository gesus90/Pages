import type { TFunction } from "i18next";
import type { ZaiQuotaWindow } from "@/definition/ZaiQuota";

/**
 * The name of a Z.AI window as a card shows it.
 * @param quotaWindow - The reported entry.
 * @param t - Translation of the interface.
 * @returns "Token-Kontingent" or "MCP-Nutzung", followed by the length of the
 * window ("5 Stunden", "1 Woche", "1 Monat") when Z.AI reports a known one.
 */
export function zaiWindowLabel(
  quotaWindow: ZaiQuotaWindow,
  t: TFunction,
): string {
  const name = t(`agentsPage.zai.window.${quotaWindow.kind}`);
  const { length } = quotaWindow;
  if (length === null) return name;
  return t("agentsPage.zai.window.named", {
    name,
    length: t(`agentsPage.zai.length.${length.unit}`, { count: length.count }),
  });
}
