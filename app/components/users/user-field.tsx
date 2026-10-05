import { Input } from "@/app/components/ui/input";

interface UserFieldProps {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly type: "text" | "email" | "password";
  readonly autoComplete?: string;
  readonly defaultValue?: string;
  readonly minLength?: number;
  readonly required?: boolean;
}

/** Renders a labelled text input of the user forms. */
export function UserField({
  id,
  label,
  ...inputProps
}: UserFieldProps): React.ReactElement {
  return (
    <>
      <label
        className="select-none text-sm font-medium text-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <Input id={id} {...inputProps} />
    </>
  );
}
