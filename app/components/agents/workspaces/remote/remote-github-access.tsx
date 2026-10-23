import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import type { RunnerGitHubResult } from "@/definition/RunnerGitHub";

/** Displays separate live SSH probes and unknown/offline states. */
export function RemoteGitHubAccess({
  workspaceId,
}: {
  readonly workspaceId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    readonly ok: boolean;
    readonly result?: RunnerGitHubResult;
  }>();
  const result = fetcher.data?.result;
  function access(allowed: boolean | null | undefined): string {
    if (allowed === undefined || allowed === null)
      return t("remote.github.unknown");
    return t(allowed ? "remote.github.allowed" : "remote.github.denied");
  }
  return (
    <div className="mt-2 space-y-1 text-xs">
      <fetcher.Form method="post" action="/settings-api/runners">
        <input type="hidden" name="intent" value="runner-repository-access" />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={fetcher.state !== "idle"}
        >
          {t("remote.github.check")}
        </Button>
      </fetcher.Form>
      {fetcher.data ? (
        <p role="status">
          {t("remote.github.read")}: {access(result?.readAccess)} ·{" "}
          {t("remote.github.write")}: {access(result?.writeAccess)}
          {result?.accessStatus
            ? ` · ${t(`remote.github.${result.accessStatus}`)}`
            : null}
        </p>
      ) : null}
      {fetcher.data?.ok === false ? (
        <p role="alert">{t("remote.github.unverifiable")}</p>
      ) : null}
      {result ? (
        <p className="text-muted-foreground">
          {t(
            result.mode === "offline"
              ? "remote.github.offline"
              : "remote.github.ssh",
          )}
        </p>
      ) : null}
    </div>
  );
}
