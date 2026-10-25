import { useTranslation } from "react-i18next";

import { SUPPORTED_OPENCODE_VERSION } from "@/definition/OpenCodeVersion";

import type { ToolInventory } from "@/definition/RemoteSetup";

/**
 * What a runner reported about OpenCode on its host: the ACP contract check
 * of the installed version and the providers set up there.
 *
 * @remarks
 * A runner without OpenCode support reports a version only, so the text asks
 * to update the runner instead of guessing a result.
 */
export function OpenCodeRemoteFacts({
  entry,
  hasOpenCodeAccess,
}: {
  readonly entry: ToolInventory;
  readonly hasOpenCodeAccess: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  if (!hasOpenCodeAccess || entry.acp === undefined)
    return (
      <span className="block text-warning">
        {t("settings.agents.runner.openCode.update")}
      </span>
    );
  const { status, reason } = entry.acp;
  return (
    <>
      <span
        className={
          status === "incompatible" ? "block text-destructive" : "block"
        }
      >
        {t(`settings.agents.runner.openCode.acp.${status}`, {
          version: entry.version ?? "?",
          supported: SUPPORTED_OPENCODE_VERSION,
          reason: t(`settings.agents.runner.openCode.reason.${reason}`),
        })}
      </span>
      {entry.providers && entry.providers.length > 0 ? (
        <span className="block">
          {t("settings.agents.runner.openCode.providers", {
            providers: entry.providers.join(", "),
          })}
        </span>
      ) : null}
    </>
  );
}
