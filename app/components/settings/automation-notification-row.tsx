import { Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { AUTOMATION_NOTIFICATION_MODES } from "@/definition/Automation";

import type { AutomationNotificationMode } from "@/definition/Automation";

interface AutomationNotificationRowProps {
  readonly mode: AutomationNotificationMode;
  readonly onChange: (mode: AutomationNotificationMode) => void;
}

/**
 * The choice when the person hears about runs of the automations they
 * created: off, on errors or always (PAGE-297).
 */
export function AutomationNotificationRow({
  mode,
  onChange,
}: AutomationNotificationRowProps): React.ReactElement {
  const { t } = useTranslation();
  const options = AUTOMATION_NOTIFICATION_MODES.map((value) => ({
    value,
    label: t(`settings.notifications.automations.modes.${value}`),
  }));

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Workflow className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {t("settings.notifications.automations.title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings.notifications.automations.description")}
        </p>
      </div>
      <Select
        size="sm"
        className="w-36"
        value={mode}
        onValueChange={onChange}
        options={options}
        ariaLabel={t("settings.notifications.automations.title")}
      />
    </div>
  );
}
