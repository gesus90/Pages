import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { showSuccessToast } from "@/app/components/ui/toast";
import { useUsersActionData } from "./use-users-action";

/** Announces each new successful management mutation without replaying previous results. */
export function ManagementFeedback(): null {
  const result = useUsersActionData();
  const previous = useRef(result);
  const { t } = useTranslation();
  useEffect(() => {
    if (result === previous.current) return;
    previous.current = result;
    if (
      result?.ok &&
      result.intent !== "create-user" &&
      result.intent !== "reset-password"
    ) {
      showSuccessToast(t("users.saved"));
    }
  }, [result, t]);
  return null;
}
