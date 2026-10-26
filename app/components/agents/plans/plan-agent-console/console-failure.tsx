import { useTranslation } from "react-i18next";

/** Names a failed history storage boundary while preserving the reader's confirmed window. */
export function ConsoleFailure({
  remote,
}: {
  readonly remote?: {
    readonly reason?: string | null;
    readonly storageError?: string;
  };
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (remote?.reason !== "storage" && !remote?.storageError) return null;
  return (
    <p role="alert" className="px-5 py-2 text-sm text-destructive">
      {t("plans.console.storageFailure", {
        code: remote.storageError ?? "journal_write_failed",
      })}
    </p>
  );
}
