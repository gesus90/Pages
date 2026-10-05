import { Input } from "@/app/components/ui/input";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface LoginFieldProps {
  /** Used as element id and as form field name. */
  readonly name: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly type: "text" | "password";
  readonly autoComplete: "username" | "current-password";
  readonly inputClassName: string;
  /** Extra classes of the outer element, for example the gap to the field above. */
  readonly className?: string;
  /** A control placed inside the field, next to the input. */
  readonly children?: ReactNode;
}

/** Renders a labelled login input with a leading icon. */
export function LoginField({
  name,
  label,
  icon: Icon,
  type,
  autoComplete,
  inputClassName,
  className,
  children,
}: LoginFieldProps): React.ReactElement {
  return (
    <div className={className}>
      <label
        className="mb-2 block text-sm font-semibold text-foreground"
        htmlFor={name}
      >
        {label}
      </label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className={inputClassName}
          id={name}
          name={name}
          type={type}
          autoComplete={autoComplete}
          placeholder={label}
          required
        />
        {children}
      </div>
    </div>
  );
}
