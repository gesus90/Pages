import { FlaskConical, PenLine } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { GoogleDriveStatus } from "@/definition/GoogleDrive";

import type { GoogleDriveCardModel } from "./use-google-drive";

/** Says that Drive is the simulation of a development server, not a Google account. */
export function GoogleDriveSimulationNotice(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      className="mt-3 flex gap-2 rounded-xl bg-info-subtle px-3 py-2 text-xs text-info"
      role="status"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <p className="min-w-0 break-words">
        {t("settings.googleDrive.simulation.text")}
      </p>
    </div>
  );
}

/** The badge that replaces the sign-in while Drive is simulated. */
export function GoogleDriveSimulationBadge(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center rounded-md bg-info-subtle px-2.5 py-1 text-xs font-semibold text-info">
      {t("settings.googleDrive.simulation.badge")}
    </span>
  );
}

/**
 * Whether the working connection lacks the write access of Storage and a
 * targeted consent can help.
 *
 * @param status - The confirmed status of the connection.
 * @returns `true` for a real, connected account without write access.
 */
export function lacksWriteAccess(status: GoogleDriveStatus): boolean {
  return (
    status.state === "connected" &&
    status.needsWriteAccess &&
    !status.isSimulation
  );
}

/**
 * Explains the missing write access of Storage and starts the targeted
 * consent for it (PAGE-270).
 *
 * @remarks
 * When the address asks for it (`?googleDriveAccess=write`, the link of
 * Storage), the notice is highlighted and scrolled into view.
 */
export function GoogleDriveWriteAccessNotice({
  model,
  status,
}: {
  readonly model: GoogleDriveCardModel;
  readonly status: GoogleDriveStatus;
}): React.ReactElement {
  const { t } = useTranslation();
  const noticeRef = useRef<HTMLDivElement>(null);
  const isHighlighted = model.isWriteAccessRequested;

  useEffect(() => {
    if (isHighlighted) {
      noticeRef.current?.scrollIntoView({ block: "center" });
    }
  }, [isHighlighted]);

  return (
    <div
      className={cn(
        "mt-3 flex flex-col gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-xs text-warning",
        isHighlighted ? "ring-2 ring-primary" : null,
      )}
      ref={noticeRef}
      role="status"
    >
      <p className="flex gap-2 font-semibold">
        <PenLine aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {t("settings.googleDrive.writeAccess.title")}
      </p>
      <p className="break-words text-foreground">
        {t("settings.googleDrive.writeAccess.text")}
      </p>
      {status.canSignIn ? (
        <div>
          <Button
            isPending={model.isStarting}
            onClick={model.grantWriteAccess}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("settings.googleDrive.writeAccess.grant")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
