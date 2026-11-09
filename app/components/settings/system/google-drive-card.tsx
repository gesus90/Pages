import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";

import googleDriveIconUrl from "@/assets/google-drive/page256-google-drive-icon.png?no-inline";
import { Button } from "@/app/components/ui/button";
import { SettingsCard } from "@/app/components/settings/settings-layout";

import {
  GoogleDriveSimulationBadge,
  GoogleDriveSimulationNotice,
  GoogleDriveWriteAccessNotice,
  lacksWriteAccess,
} from "./google-drive-access-notices";
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

/** Whether only a new Google sign-in moves the connection forward. */
function awaitsSignIn(status: GoogleDriveStatus): boolean {
  return (
    status.state === "disconnected" ||
    status.state === "reauthorization_required" ||
    status.needsFolderAccess
  );
}

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

  if (reading.status.isSimulation) {
    // The simulation has no Google sign-in; starting one only fails.
    return <GoogleDriveSimulationBadge />;
  }

  if (!reading.status.canSignIn || !awaitsSignIn(reading.status)) {
    return state === "connected" ? <ConnectedBadge /> : null;
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
      redirectUris: status.redirectUris.join(", "),
      settings: status.missingSettings.join(", "),
    });
  if (!status.canSignIn && awaitsSignIn(status))
    return t("settings.googleDrive.originNotAllowed", {
      origins: status.redirectUris
        .map((redirectUri) => new URL(redirectUri).origin)
        .join(", "),
    });
  if (status.needsFolderAccess)
    return t("settings.googleDrive.folderAccessMissing");
  return status.problem === null
    ? null
    : t(`settings.googleDrive.problem.${status.problem}`);
}

/** The notices about the simulation and the missing write access, when they apply. */
function GoogleDriveAccessNotices({
  model,
}: {
  readonly model: GoogleDriveCardModel;
}): React.ReactElement | null {
  if (model.reading.kind !== "loaded") {
    return null;
  }

  const { status } = model.reading;

  // A read-only simulation names the missing access too; without a sign-in
  // in the simulation the notice offers no button (PAGE-272).
  if (status.isSimulation) {
    return (
      <>
        <GoogleDriveSimulationNotice />
        {status.state === "connected" && status.needsWriteAccess ? (
          <GoogleDriveWriteAccessNotice model={model} status={status} />
        ) : null}
      </>
    );
  }

  return lacksWriteAccess(status) ? (
    <GoogleDriveWriteAccessNotice model={model} status={status} />
  ) : null;
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
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            alt=""
            className="h-5 w-auto shrink-0"
            draggable={false}
            height={20}
            src={googleDriveIconUrl}
            width={22}
          />
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
        </div>
        <div className="shrink-0">
          <GoogleDriveAction model={model} />
        </div>
      </div>
      <GoogleDriveAccessNotices model={model} />
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
