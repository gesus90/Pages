import { AuthHeading } from "@/app/components/auth/auth-heading";

import type { FormEvent, ReactNode } from "react";

interface SetupStepFormProps {
  readonly title: string;
  readonly subtitle: string;
  /** Whether the Pages logo is shown above the title. */
  readonly hasLogo?: boolean;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}

/**
 * Renders one wizard step as a form, so the Enter key continues.
 *
 * @remarks
 * The values stay in the wizard state; the form element only provides
 * keyboard submission and grouping.
 */
export function SetupStepForm({
  title,
  subtitle,
  hasLogo = false,
  onSubmit,
  children,
}: SetupStepFormProps): React.ReactElement {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      <AuthHeading title={title} subtitle={subtitle} hasLogo={hasLogo} />
      {children}
    </form>
  );
}
