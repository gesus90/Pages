import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { CALENDAR_SCOPES } from "@/definition/Calendar";

import type { CalendarScope } from "@/definition/Calendar";

interface CalendarScopeChoiceProps {
  /** Whether the choice is for a change or a deletion. */
  readonly action: "edit" | "delete";
  readonly isPending?: boolean;
  readonly onChoose: (scope: CalendarScope) => void;
  readonly onCancel: () => void;
}

/**
 * Asks which occurrences of a series a change or a deletion covers:
 * „Nur dieser Termin“, „Dieser und alle folgenden“ or „Alle Termine der Serie“.
 */
export function CalendarScopeChoice({
  action,
  isPending = false,
  onChoose,
  onCancel,
}: CalendarScopeChoiceProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <fieldset className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3">
      <legend className="sr-only">{t(`calendar.scope.${action}`)}</legend>
      <p className="text-sm font-medium text-foreground">
        {t(`calendar.scope.${action}`)}
      </p>
      {CALENDAR_SCOPES.map((scope) => (
        <Button
          key={scope}
          size="sm"
          variant={action === "delete" ? "destructive-soft" : "outline"}
          className="justify-start"
          isPending={isPending}
          onClick={() => onChoose(scope)}
        >
          {t(`calendar.scope.${scope}`)}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t("calendar.cancel")}
      </Button>
    </fieldset>
  );
}
