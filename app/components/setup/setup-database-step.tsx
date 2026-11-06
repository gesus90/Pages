import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AuthField } from "@/app/components/auth/auth-field";
import { focusOnMount } from "@/app/lib/focus-on-mount";
import {
  canUseDatabaseLocation,
  DATABASE_LOCATION_STATUS,
  MAXIMUM_DATABASE_URL_LENGTH,
} from "@/definition/Setup";

import {
  DATABASE_URL_FEEDBACK_ID,
  DatabaseUrlFeedback,
} from "./database-path-feedback";
import { SetupFormError } from "./setup-form-error";
import { SetupStepActions } from "./setup-step-actions";
import { SetupStepForm } from "./setup-step-form";
import { useDatabaseUrlCheck } from "./use-database-path-check";

import type { SetupRejection } from "@/app/lib/setup/setup-action-data";
import type { DatabaseLocationStatus } from "@/definition/Setup";
import type { SetupCompletion } from "./use-setup-completion";
import type { SetupDraft } from "./use-setup-draft";

/** Outcomes that block the setup and mark the field as rejected. */
const REJECTED_STATUSES: ReadonlySet<DatabaseLocationStatus> = new Set([
  DATABASE_LOCATION_STATUS.INVALID,
  DATABASE_LOCATION_STATUS.NOT_WRITABLE,
  DATABASE_LOCATION_STATUS.FOREIGN,
]);

interface SetupDatabaseStepProps {
  readonly draft: SetupDraft;
  readonly token: string;
  readonly completion: SetupCompletion;
  readonly onRejected: (rejection: SetupRejection) => void;
}

/**
 * Renders the last wizard step: the database connection with its live check and
 * the action that finishes the setup.
 */
export function SetupDatabaseStep({
  draft,
  token,
  completion,
  onRejected,
}: SetupDatabaseStepProps): React.ReactElement {
  const { t } = useTranslation();
  const databaseUrl = draft.values.databaseUrl;
  const check = useDatabaseUrlCheck(token, databaseUrl, onRejected);
  const status = check.status;
  const canFinish = status !== null && canUseDatabaseLocation(status);

  // The disabled submit button blocks Enter as well, so a connection that cannot
  // be used is never submitted from here.
  function handleFinish(): void {
    completion.finish(token, draft.values);
  }

  return (
    <SetupStepForm
      title={t("setup.database.title")}
      subtitle={t("setup.database.subtitle")}
      onSubmit={handleFinish}
    >
      <AuthField
        ref={focusOnMount}
        className="mt-8"
        name="databaseUrl"
        type="password"
        label={t("setup.database.label")}
        icon={Database}
        autoComplete="off"
        spellCheck={false}
        maxLength={MAXIMUM_DATABASE_URL_LENGTH}
        required
        value={databaseUrl}
        onChange={(event) => draft.setField("databaseUrl", event.target.value)}
        describedBy={DATABASE_URL_FEEDBACK_ID}
        aria-invalid={
          status !== null && REJECTED_STATUSES.has(status) ? true : undefined
        }
      />
      <DatabaseUrlFeedback status={status} hasFailed={check.hasFailed} />
      {completion.refusedLocation ? (
        <SetupFormError
          message={t(
            `setup.database.status.${completion.refusedLocation.status}`,
          )}
        />
      ) : null}
      {completion.error ? (
        <SetupFormError message={t(`setup.error.${completion.error}`)} />
      ) : null}
      <SetupStepActions
        submitLabel={t("setup.database.finish")}
        pendingLabel={t("setup.database.finishing")}
        isPending={completion.isFinishing}
        isSubmitDisabled={!canFinish}
        onBack={draft.goBack}
      />
    </SetupStepForm>
  );
}
