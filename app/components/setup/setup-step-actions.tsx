import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AuthSubmitButton } from "@/app/components/auth/auth-submit-button";
import { Button } from "@/app/components/ui/button";

interface SetupStepActionsProps {
  readonly submitLabel: string;
  readonly pendingLabel?: string;
  readonly isPending?: boolean;
  readonly isSubmitDisabled?: boolean;
  /** Returns to the previous step; without it no back button is shown. */
  readonly onBack?: () => void;
}

/** Renders the primary action of a wizard step and the way back. */
export function SetupStepActions({
  submitLabel,
  pendingLabel = submitLabel,
  isPending = false,
  isSubmitDisabled = false,
  onBack,
}: SetupStepActionsProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <AuthSubmitButton
        label={submitLabel}
        pendingLabel={pendingLabel}
        isPending={isPending}
        disabled={isSubmitDisabled}
      />
      {onBack ? (
        <Button variant="ghost" onClick={onBack} disabled={isPending}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("setup.back")}
        </Button>
      ) : null}
    </div>
  );
}
