import { useState } from "react";

import { SetupAdministratorStep } from "./setup-administrator-step";
import { SetupCompanyStep } from "./setup-company-step";
import { SetupCompleted } from "./setup-completed";
import { SetupDatabaseStep } from "./setup-database-step";
import { SetupProgress } from "./setup-progress";
import { SetupTokenForm } from "./setup-token-form";
import { SetupWelcomeStep } from "./setup-welcome-step";
import { useSetupAccess } from "./use-setup-access";
import { useSetupCompletion } from "./use-setup-completion";
import { SETUP_STEPS, useSetupDraft } from "./use-setup-draft";

import type {
  SetupAccess,
  SetupRejection,
} from "@/app/lib/setup/setup-action-data";
import type { SetupCompletion } from "./use-setup-completion";
import type { SetupDraft } from "./use-setup-draft";

interface SetupWizardProps {
  /** Access granted by the token in the setup link. */
  readonly initialAccess: SetupAccess | null;
  /** Whether the setup link carried a token that is not valid. */
  readonly hasRejectedToken: boolean;
}

interface SetupWizardStepsProps {
  readonly access: SetupAccess;
  readonly draft: SetupDraft;
  readonly onRejected: (rejection: SetupRejection, token: string) => void;
}

interface SetupStepContentProps {
  readonly draft: SetupDraft;
  readonly token: string;
  readonly completion: SetupCompletion;
  readonly onRejected: (rejection: SetupRejection) => void;
}

function SetupStepContent({
  draft,
  token,
  completion,
  onRejected,
}: SetupStepContentProps): React.ReactElement {
  switch (draft.step) {
    case "welcome":
      return <SetupWelcomeStep onStart={draft.goForward} />;
    case "company":
      return <SetupCompanyStep draft={draft} />;
    case "administrator":
      return <SetupAdministratorStep draft={draft} />;
    case "database":
      return (
        <SetupDatabaseStep
          draft={draft}
          token={token}
          completion={completion}
          onRejected={onRejected}
        />
      );
  }
}

/** Renders the progress and the current step once access was granted. */
function SetupWizardSteps({
  access,
  draft,
  onRejected,
}: SetupWizardStepsProps): React.ReactElement {
  function handleRejected(rejection: SetupRejection): void {
    onRejected(rejection, access.token);
  }

  const completion = useSetupCompletion({
    onFieldErrors: draft.showFieldErrors,
    onRejected: handleRejected,
  });

  return (
    <>
      <SetupProgress current={draft.stepIndex + 1} total={SETUP_STEPS.length} />
      <SetupStepContent
        draft={draft}
        token={access.token}
        completion={completion}
        onRejected={handleRejected}
      />
    </>
  );
}

/**
 * Guides through the four setup steps: welcome, company, administrator,
 * and database.
 *
 * @remarks
 * All entered values stay in memory only. They survive moving between
 * steps, a language change, and a renewed token, but not a reload; a
 * reload starts the wizard from the beginning.
 */
export function SetupWizard({
  initialAccess,
  hasRejectedToken,
}: SetupWizardProps): React.ReactElement {
  const setupAccess = useSetupAccess(initialAccess, hasRejectedToken);
  const { access } = setupAccess;
  const draft = useSetupDraft(access?.suggestedDatabasePath ?? null);
  const [isAlreadyCompleted, setIsAlreadyCompleted] = useState(false);

  function handleRejected(rejection: SetupRejection, token: string): void {
    if (rejection === "alreadyCompleted") {
      setIsAlreadyCompleted(true);
    } else {
      setupAccess.revoke(token);
    }
  }

  if (isAlreadyCompleted) {
    return <SetupCompleted />;
  }

  if (access === null) {
    return (
      <SetupTokenForm
        tokenFetcher={setupAccess.tokenFetcher}
        notice={setupAccess.notice}
      />
    );
  }

  return (
    <SetupWizardSteps
      access={access}
      draft={draft}
      onRejected={handleRejected}
    />
  );
}
