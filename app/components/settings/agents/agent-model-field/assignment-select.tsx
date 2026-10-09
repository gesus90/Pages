import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

/** Shared labeled assignment field with wrapping text for long catalog IDs. */
export function AssignmentSelect({
  field,
  ...props
}: {
  readonly field: string;
} & Pick<
  React.ComponentProps<typeof Select>,
  "value" | "options" | "disabled" | "onValueChange"
>): React.ReactElement {
  const { t } = useTranslation();
  const label = t(`assistant.settings.${field}`);
  return (
    <div className="min-w-0 space-y-2">
      <label
        htmlFor={`assignment-${field}`}
        className="block text-sm font-medium"
      >
        {label}
      </label>
      <Select
        {...props}
        id={`assignment-${field}`}
        ariaLabel={label}
        className="h-auto min-h-9 w-full text-left [&>span]:min-w-0 [&>span]:break-all [&>span]:whitespace-normal"
      />
    </div>
  );
}
