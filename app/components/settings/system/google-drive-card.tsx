import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { SettingsCard } from "@/app/components/settings/settings-layout";

import { useGoogleDrive } from "./use-google-drive";

import type {
  GoogleDriveConnectionState,
  GoogleDriveStatus,
} from "@/definition/GoogleDrive";
import type { TFunction } from "i18next";

import type {
  GoogleDriveCardModel,
  GoogleDriveReading,
} from "./use-google-drive";

/** The short status line under the service name, per connection state. */
const STATE_LABELS: Readonly<Record<GoogleDriveConnectionState, string>> = {
  connected: "settings.googleDrive.connected",
  disconnected: "settings.googleDrive.disconnected",
  not_configured: "settings.googleDrive.notConfigured",
  reauthorization_required: "settings.googleDrive.reauthorizationRequired",
  unavailable: "settings.googleDrive.unavailable",
};

function ConnectedBadge(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center rounded-md bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success">
      {t("settings.googleDrive.connected")}
    </span>
  );
}

/** The badge when Drive confirmed the connection, the sign-in button when one helps. */
function GoogleDriveAction({
  model,
}: {
  readonly model: GoogleDriveCardModel;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { reading } = model;

  if (reading.kind !== "loaded") {
    return null;
  }

  const { state } = reading.status;

  if (state === "connected") {
    return <ConnectedBadge />;
  }

  if (state !== "disconnected" && state !== "reauthorization_required") {
    return null;
  }

  return (
    <Button
      disabled={model.isStarting}
      isPending={model.isStarting}
      onClick={model.signIn}
      size="sm"
      type="button"
      variant="outline"
    >
      {t(
        state === "disconnected"
          ? "settings.googleDrive.signIn"
          : "settings.googleDrive.signInAgain",
      )}
    </Button>
  );
}

function describeReading(reading: GoogleDriveReading, t: TFunction): string {
  if (reading.kind === "loading") return t("settings.googleDrive.checking");
  if (reading.kind === "failed") return t("settings.googleDrive.loadFailed");
  const { status } = reading;
  if (status.state === "connected" && status.accountEmail !== null)
    return t("settings.googleDrive.connectedAccount", {
      account: status.accountEmail,
    });
  if (status.state === "connected")
    return t("settings.googleDrive.connectedNoAccount");
  return t(STATE_LABELS[status.state]);
}

/** The error that belongs to the status: a problem Drive named or the missing settings. */
function statusProblem(status: GoogleDriveStatus, t: TFunction): string | null {
  if (status.state === "not_configured")
    return t("settings.googleDrive.missingSettings", {
      redirectUri: status.redirectUri,
      settings: status.missingSettings.join(", "),
    });
  return status.problem === null
    ? null
    : t(`settings.googleDrive.problem.${status.problem}`);
}

/** Every error message the card shows right now, newest cause first. */
function useGoogleDriveMessages(model: GoogleDriveCardModel): string[] {
  const { t } = useTranslation();
  const messages: string[] = [];

  if (model.startError !== null)
    messages.push(t(`settings.googleDrive.startFailed.${model.startError}`));
  if (model.outcome !== null && model.outcome !== "connected")
    messages.push(t(`settings.googleDrive.outcome.${model.outcome}`));
  if (model.reading.kind === "loaded") {
    const problem = statusProblem(model.reading.status, t);
    if (problem !== null) messages.push(problem);
  }

  return messages;
}

/**
 * The compact Google Drive sign-in of the system settings (PAGE-170).
 *
 * @remarks
 * It shows only the sign-in, the truthful status and the errors that belong to
 * them. "Connected" appears only after the server confirmed the connection
 * with a real read-only Drive request during this visit.
 */
export function GoogleDriveCard(): React.ReactElement {
  const { t } = useTranslation();
  const model = useGoogleDrive();
  const messages = useGoogleDriveMessages(model);

  return (
    <SettingsCard
      className="min-w-0"
      description={t("settings.googleDrive.description")}
      icon={<Database aria-hidden="true" className="size-4" />}
      title={t("settings.googleDrive.title")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t("settings.googleDrive.service")}
          </p>
          <p
            aria-live="polite"
            className="mt-0.5 text-xs break-words text-muted-foreground"
          >
            {describeReading(model.reading, t)}
          </p>
        </div>
        <div className="shrink-0">
          <GoogleDriveAction model={model} />
        </div>
      </div>
      {messages.length > 0 ? (
        <ul
          className="mt-3 flex flex-col gap-1 text-xs break-words text-destructive"
          role="alert"
        >
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </SettingsCard>
  );
}
