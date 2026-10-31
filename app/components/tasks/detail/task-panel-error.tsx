import { useTranslation } from "react-i18next";
import { useActionData } from "react-router";

import type { action } from "@/app/routes/tasks";

/** Reports a failed detail action without dismissing the ticket. */
export function TaskPanelError(): React.ReactElement | null {
  const result = useActionData<typeof action>();
  const { t } = useTranslation();
  if (!result || result.ok) return null;
  return (
    <p
      className="mx-5 mt-4 rounded-lg bg-notice-subtle px-3 py-2 text-sm text-notice"
      role="alert"
    >
      {t(`tasks.error.${result.error}`)}
    </p>
  );
}
