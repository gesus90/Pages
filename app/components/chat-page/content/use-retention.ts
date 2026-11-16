import { useTranslation } from "react-i18next";

import { retentionLabel } from "./file-retention";
import { useNow } from "./use-now";

/**
 * The remaining time of a file of an agent as the head of its card says it,
 * updated every minute.
 * @param expiresAt - When the file is removed; `undefined` for one that stays.
 * @returns For example "noch 2 Tage"; `null` for a file that stays and
 * before the page knows the time.
 */
export function useRetention(expiresAt: string | undefined): string | null {
  const { t } = useTranslation();
  const now = useNow();
  return now === null ? null : retentionLabel(expiresAt, now, t);
}
