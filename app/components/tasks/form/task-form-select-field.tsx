import { Select } from "@/app/components/ui/select";

import type { TaskFormOption } from "./task-form-options";

interface TaskFormSelectFieldProps<Value extends string> {
  /** Id of the select, which the label points at. */
  readonly id: string;
  readonly label: string;
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly TaskFormOption<Value>[];
  readonly isDisabled?: boolean;
}

/** A labelled select of the work item form. */
export function TaskFormSelectField<Value extends string>({
  id,
  label,
  value,
  onValueChange,
  options,
  isDisabled = false,
}: TaskFormSelectFieldProps<Value>): React.ReactElement {
  return (
    <div>
      <label
        className="block select-none text-sm font-medium text-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <Select
        id={id}
        ariaLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={isDisabled}
        className="min-w-36"
        options={options}
      />
    </div>
  );
}
