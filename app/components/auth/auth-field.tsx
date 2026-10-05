import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

interface AuthFieldProps extends Omit<
  ComponentProps<"input">,
  "className" | "id" | "name"
> {
  /** Used as element id and as form field name. */
  readonly name: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Message of a rejected value, shown below the field. */
  readonly error?: string | null;
  /** Ids of further elements that describe the field. */
  readonly describedBy?: string;
  /** Extra classes of the outer element, for example the gap to the field above. */
  readonly className?: string;
  /** A control placed inside the field, at its end. */
  readonly children?: ReactNode;
}

/**
 * Renders a labelled field of the login and setup pages with a leading icon.
 *
 * @remarks
 * The error message is linked to the field, so assistive technology reads
 * it together with the label.
 */
export function AuthField({
  name,
  label,
  icon: Icon,
  error,
  describedBy,
  className,
  children,
  ...inputProperties
}: AuthFieldProps): React.ReactElement {
  const errorId = `${name}-error`;
  const descriptionIds = [error ? errorId : null, describedBy ?? null]
    .filter((id) => id !== null)
    .join(" ");

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
          variant="auth"
          className={cn(children ? "pr-14" : null)}
          id={name}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={descriptionIds || undefined}
          {...inputProperties}
        />
        {children}
      </div>
      {error ? (
        <p
          className="pages-selectable mt-1.5 text-xs text-destructive"
          id={errorId}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
