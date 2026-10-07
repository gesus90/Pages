import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";

interface TaskFormTextFieldProps {
  /** Id of the control, which the label points at. */
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly defaultValue: string;
  readonly maxLength?: number;
  readonly type?: "text" | "date" | "textarea";
  readonly isRequired?: boolean;
  /** Short usage hint shown below a textarea. */
  readonly hint?: string;
}

/** A labelled text, date or multi-line field of the work item form. */
export function TaskFormTextField({
  id,
  label,
  name,
  defaultValue,
  maxLength,
  type = "text",
  isRequired = false,
  hint,
}: TaskFormTextFieldProps): React.ReactElement {
  return (
    <div>
      <label
        className="block select-none text-sm font-medium text-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      {type === "textarea" ? (
        <Textarea
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="mt-1 resize-y"
          defaultValue={defaultValue}
          id={id}
          maxLength={maxLength}
          name={name}
        />
      ) : (
        <Input
          className="mt-1"
          defaultValue={defaultValue}
          id={id}
          maxLength={maxLength}
          name={name}
          required={isRequired}
          type={type}
        />
      )}
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
