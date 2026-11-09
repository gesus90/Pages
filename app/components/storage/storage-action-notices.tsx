import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button, buttonVariants } from "@/app/components/ui/button";

import { formatBytes } from "./storage-format";
import { Notice } from "./storage-notices";

import type {
  StorageCapabilities,
  StorageError,
} from "@/definition/GoogleDriveFiles";
import type { TFunction } from "i18next";

/** Where the targeted consent for the write access starts. */
const WRITE_CONSENT_PATH = "/settings/system?googleDriveAccess=write";

/**
 * The translated message of a failed Storage call.
 *
 * @param error - The error of the server or of the upload check.
 * @param t - Translation function.
 * @param language - The language of the view, for the size limit.
 * @returns One readable sentence.
 */
export function storageErrorMessage(
  error: StorageError,
  t: TFunction,
  language: string,
): string {
  if (error.code === "too_large" && error.limitBytes !== undefined) {
    return t("storage.error.tooLargeLimit", {
      limit: formatBytes(error.limitBytes, language),
    });
  }

  return t(`storage.error.${error.code}`, {
    defaultValue: t("storage.error.failed"),
  });
}

function ConsentLink({ path }: { readonly path: string }): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Link
      className={buttonVariants({ size: "sm", variant: "outline" })}
      to={path}
    >
      <KeyRound aria-hidden="true" className="size-4" />
      {t("storage.write.grant")}
    </Link>
  );
}

/** Says that Drive is the in-memory simulation of a development server. */
export function StorageSimulationBanner(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice title={t("storage.simulation.title")} tone="info">
      <p>{t("storage.simulation.text")}</p>
    </Notice>
  );
}

/**
 * Explains why nothing can be changed: the full Drive access is missing, or
 * the simulation runs a read-only scenario. Both lead to the new sign-in
 * under Settings → System (PAGE-272).
 */
export function StorageReadOnlyNotice({
  capabilities,
}: {
  readonly capabilities: StorageCapabilities;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice
      actions={<ConsentLink path={WRITE_CONSENT_PATH} />}
      title={t(
        capabilities.isSimulation
          ? "storage.write.readOnlyScenario"
          : "storage.write.missingTitle",
      )}
      tone="info"
    >
      <p>{t("storage.write.missingText")}</p>
    </Notice>
  );
}

/** Reports a failed change; a missing write access links to its consent. */
export function StorageActionError({
  error,
  onDismiss,
}: {
  readonly error: StorageError;
  /** Hides the message; without it the message stays. */
  readonly onDismiss?: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const consentPath =
    error.code === "provider_scope_missing"
      ? (error.consentPath ?? WRITE_CONSENT_PATH)
      : null;
  const hasActions = consentPath !== null || onDismiss !== undefined;

  return (
    <Notice
      actions={
        hasActions ? (
          <>
            {consentPath === null ? null : <ConsentLink path={consentPath} />}
            {onDismiss ? (
              <Button
                onClick={onDismiss}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("storage.actions.dismiss")}
              </Button>
            ) : null}
          </>
        ) : null
      }
      title={
        consentPath === null
          ? storageErrorMessage(error, t, i18n.language)
          : t("storage.write.missingTitle")
      }
      tone="destructive"
    >
      {consentPath === null ? null : (
        <p>{storageErrorMessage(error, t, i18n.language)}</p>
      )}
    </Notice>
  );
}
