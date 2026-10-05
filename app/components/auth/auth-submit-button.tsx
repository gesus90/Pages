import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { ButtonHTMLAttributes } from "react";

interface AuthSubmitButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  readonly label: string;
  /** Label while the action runs; a spinner is shown in front of it. */
  readonly pendingLabel: string;
  readonly isPending: boolean;
}

/**
 * Renders the primary action of a login or setup card.
 *
 * @remarks
 * While the action runs, the button is disabled and shows a spinner next to
 * its label, so a second submission cannot start.
 */
export function AuthSubmitButton({
  label,
  pendingLabel,
  isPending,
  disabled,
  className,
  type = "submit",
  ...buttonProperties
}: AuthSubmitButtonProps): React.ReactElement {
  return (
    <Button
      className={cn("relative", className)}
      variant="auth"
      type={type}
      disabled={isPending || disabled}
      {...buttonProperties}
    >
      {isPending ? (
        <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden="true" />
      ) : null}
      <span>{isPending ? pendingLabel : label}</span>
      {isPending ? null : (
        <ArrowRight
          className="pointer-events-none absolute top-1/2 right-6 size-5 -translate-y-1/2"
          aria-hidden="true"
        />
      )}
    </Button>
  );
}
