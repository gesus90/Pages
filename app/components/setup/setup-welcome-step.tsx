import { useTranslation } from "react-i18next";

import { SetupStepActions } from "./setup-step-actions";
import { SetupStepForm } from "./setup-step-form";

interface SetupWelcomeStepProps {
  readonly onStart: () => void;
}

/** Renders the first wizard step with the single action to get started. */
export function SetupWelcomeStep({
  onStart,
}: SetupWelcomeStepProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SetupStepForm
      title={t("setup.welcome.title")}
      subtitle={t("setup.welcome.subtitle")}
      hasLogo
      onSubmit={onStart}
    >
      <SetupStepActions submitLabel={t("setup.welcome.start")} />
    </SetupStepForm>
  );
}
