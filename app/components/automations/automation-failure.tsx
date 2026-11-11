import { useTranslation } from "react-i18next";

import type { AutomationActionFailure } from "./use-automation-actions";

/**
 * Says why a change was refused: by its reason, else by its code, with the
 * service's list of problems below.
 */
export function AutomationFailureMessage({
  failure,
}: {
  readonly failure: AutomationActionFailure;
}): React.ReactElement {
  const { t } = useTranslation();
  const byCode = t(`automations.errors.${failure.code}`, {
    defaultValue: t("automations.errors.unknown"),
  });
  const message = failure.reason
    ? t(`automations.errors.${failure.reason}`, { defaultValue: byCode })
    : byCode;
  return (
    <div
      className="rounded-xl bg-destructive-subtle px-3 py-2.5 text-sm text-destructive"
      role="alert"
    >
      <p>{message}</p>
      {failure.problems.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 font-mono text-xs">
          {failure.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
