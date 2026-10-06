import { Input } from "@/app/components/ui/input";

interface UserFieldProps {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly type: "text" | "email" | "password" | "number";
  readonly autoComplete?: string;
  readonly defaultValue?: string | number;
  readonly min?: number;
  readonly step?: number;
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
      <label className="text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      <Input id={id} {...inputProps} />
    </>
  );
}
