import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import type { AgentToolView } from "@/definition/AgentTools";

/** Update states that report a problem rather than a result. */
const PROBLEM_STATES: ReadonlySet<string> = new Set([
  "check_failed",
  "source_unreachable",
  "incompatible",
]);

function PairedToolFact({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (tool.hasIntegratedAdapter)
    return (
      <>
        <dt className="text-muted-foreground">
          {t("agentTools.pairedAdapter")}
        </dt>
        <dd>{t("agentTools.integratedAdapter")}</dd>
      </>
    );
  if (!tool.pairedTool) return null;
  return (
    <>
      <dt className="text-muted-foreground">
        {t(
          tool.kind === "acp"
            ? "agentTools.pairedCli"
            : "agentTools.pairedAdapter",
        )}
      </dt>
      <dd>{t(`agentTools.names.${tool.pairedTool}`)}</dd>
    </>
  );
}

/**
 * Shows the active, the newest stable and the target release with their source.
 * @remarks
 * CLI and adapter each have their own card and versions; a failed or
 * unreachable source is shown as such and never as current.
 */
export function AgentToolReleaseFacts({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const { release } = tool;
  return (
    <>
      <dt className="text-muted-foreground">{t("agentTools.activeVersion")}</dt>
      <dd className="break-words">{tool.activeVersion ?? "—"}</dd>
      <PairedToolFact tool={tool} />
      {release.source ? (
        <>
          <dt className="text-muted-foreground">
            {t("agentTools.release.title")}
          </dt>
          <dd className="break-words">
            {release.latestVersion ?? "—"} ·{" "}
            <span
              className={
                PROBLEM_STATES.has(release.state)
                  ? "text-destructive"
                  : undefined
              }
            >
              {t(`agentTools.release.state.${release.state}`)}
            </span>
          </dd>
          <dt className="text-muted-foreground">
            {t("agentTools.release.target")}
          </dt>
          <dd className="break-words">{release.targetVersion ?? "—"}</dd>
          <dt className="text-muted-foreground">
            {t("agentTools.release.source")}
          </dt>
          <dd className="break-all">{release.source}</dd>
          <dt className="text-muted-foreground">
            {t("agentTools.release.checkedAt")}
          </dt>
          <dd>{formatDateTime(release.checkedAt)}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">
        {t("agentTools.lastSuccessfulCheck")}
      </dt>
      <dd>{formatDateTime(tool.lastSuccessfulCheck)}</dd>
    </>
  );
}
