import { useId } from "react";

import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import type { ReactNode } from "react";

/** A choice of a {@link ChoiceRow} or a {@link FieldSelect}. */
export interface FieldOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
}

interface FormFieldProps {
  readonly label: string;
  /** The ID of the control the label names; without it the label is plain text. */
  readonly htmlFor?: string;
  readonly hint?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** A labeled field of the panel. */
export function FormField({
  label,
  htmlFor,
  hint,
  className,
  children,
}: FormFieldProps): React.ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {htmlFor ? (
        <label className="text-xs text-muted-foreground" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface ChoiceRowProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly FieldOption<Value>[];
  readonly onChange: (value: Value) => void;
  readonly isReadOnly: boolean;
}

/**
 * A labeled row of pressed buttons over the full width, such as "Zeit /
 * Ereignis / Nur manuell".
 *
 * @remarks
 * Unlike the shared segmented control it can be read only: the panel shows
 * a saved automation in the same layout as the editor.
 */
export function ChoiceRow<Value extends string>({
  label,
  value,
  options,
  onChange,
  isReadOnly,
}: ChoiceRowProps<Value>): React.ReactElement {
  return (
    <FormField label={label}>
      <div
        aria-label={label}
        className="grid auto-cols-fr grid-flow-col gap-1.5"
        role="group"
      >
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              aria-pressed={isActive}
              className={cn(
                "h-9 truncate rounded-lg border px-2 text-xs font-medium transition-colors disabled:cursor-default",
                isActive
                  ? "border-primary bg-primary-subtle text-foreground"
                  : "border-border bg-surface text-muted-foreground enabled:hover:text-foreground",
              )}
              disabled={isReadOnly}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </FormField>
  );
}

interface FieldSelectProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly FieldOption<Value>[];
  readonly onChange: (value: Value) => void;
  readonly isReadOnly: boolean;
  readonly className?: string;
}

/** A labeled select of the panel; read only it keeps its full contrast. */
export function FieldSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
  isReadOnly,
  className,
}: FieldSelectProps<Value>): React.ReactElement {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id} className={className}>
      <Select
        id={id}
        size="default"
        className="w-full disabled:cursor-default disabled:opacity-100"
        value={value}
        onValueChange={onChange}
        options={options}
        disabled={isReadOnly}
      />
    </FormField>
  );
}

/** A one-line read-only value styled like a field, such as "16:00 · Europe/Berlin". */
export function FieldValue({
  children,
  isInvalid = false,
}: {
  readonly children: ReactNode;
  readonly isInvalid?: boolean;
}): React.ReactElement {
  return (
    <p
      className={cn(
        "flex h-11 min-w-0 items-center truncate rounded-xl bg-surface px-4 text-base shadow-field xl:h-9 xl:px-3 xl:text-sm",
        isInvalid && "border border-destructive",
      )}
    >
      {children}
    </p>
  );
}
