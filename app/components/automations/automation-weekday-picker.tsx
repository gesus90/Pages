import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { FormField } from "./automation-form-controls";

const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

interface WeekdayPickerProps {
  readonly label: string;
  readonly weekdays: readonly number[];
  readonly onChange: (weekdays: readonly number[]) => void;
}

/** Toggles for Monday to Sunday. */
export function WeekdayPicker({
  label,
  weekdays,
  onChange,
}: WeekdayPickerProps): React.ReactElement {
  const { t } = useTranslation();

  function toggle(day: number): void {
    onChange(
      weekdays.includes(day)
        ? weekdays.filter((entry) => entry !== day)
        : [...weekdays, day],
    );
  }

  return (
    <FormField label={label}>
      <div aria-label={label} className="grid grid-cols-7 gap-1" role="group">
        {WEEKDAYS.map((day) => {
          const isOn = weekdays.includes(day);
          return (
            <button
              aria-pressed={isOn}
              className={cn(
                "h-8 rounded-lg border text-xs font-medium transition-colors",
                isOn
                  ? "border-primary bg-primary-subtle text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
              key={day}
              onClick={() => toggle(day)}
              type="button"
            >
              {t(`automations.weekdays.short.${day}`)}
            </button>
          );
        })}
      </div>
    </FormField>
  );
}
