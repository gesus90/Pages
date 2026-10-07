import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

interface PasswordFieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly autoComplete: "current-password" | "new-password";
  /** Extra classes of the label, for example the gap to the field above. */
  readonly labelClassName?: string;
}

/** Renders a labelled password input of the password dialog. */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  labelClassName,
}: PasswordFieldProps): React.ReactElement {
  return (
    <>
      <label
        className={cn(labelClassName, "text-sm font-medium text-foreground")}
        htmlFor={id}
      >
        {label}
      </label>
      <Input autoComplete={autoComplete} id={id} name={name} type="password" />
    </>
  );
}
