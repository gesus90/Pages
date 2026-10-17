import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { AgentToolActions } from "./agent-tool-actions";

import type { AgentToolView } from "@/definition/AgentTools";

interface ToolActionResult {
  readonly ok: boolean;
  readonly diagnostic?: string;
  readonly error?: string;
}

/** Shows installation, functional readiness and native activity as distinct facts. */
export function AgentToolCard({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const fetcher = useFetcher<ToolActionResult>();
  const isPending = fetcher.state !== "idle";
  return (
    <section
      className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4"
      aria-label={t(`agentTools.names.${tool.id}`)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t(`agentTools.names.${tool.id}`)}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`agentTools.kind.${tool.kind}`)}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-sm">
          {t(`agentTools.status.${tool.status}`)}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">
          {t("agentTools.installation")}
        </dt>
        <dd>
          {t(installationLabel(tool.installed))} ·{" "}
          {t(`agentTools.source.${tool.source ?? "none"}`)}
        </dd>
        <ToolVersionFacts tool={tool} />
        <dt className="text-muted-foreground">{t("agentTools.enabled")}</dt>
        <dd>{t(tool.enabled ? "agentTools.yes" : "agentTools.no")}</dd>
        <dt className="text-muted-foreground">{t("agentTools.lastCheck")}</dt>
        <dd>{formatDateTime(tool.lastCheck)}</dd>
        <dt className="text-muted-foreground">{t("agentTools.processes")}</dt>
        <dd>{tool.activities.length}</dd>
      </dl>
      {tool.updateAvailable ? (
        <p className="text-sm text-primary-text">
          {t("agentTools.updateAvailable")}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t(`agentTools.diagnostic.${tool.diagnostic}`)}
        {tool.dependency
          ? ` (${t(`agentTools.names.${tool.dependency}`)})`
          : ""}
      </p>
      <ToolActivity tool={tool} />
      <fetcher.Form
        method="post"
        action="/settings/agents/tools"
        className="flex flex-wrap gap-2"
      >
        <input type="hidden" name="tool" value={tool.id} />
        <AgentToolActions tool={tool} isPending={isPending} />
      </fetcher.Form>
      <div aria-live="polite" className="text-sm">
        <ToolOutcome isPending={isPending} result={fetcher.data} />
      </div>
    </section>
  );
}

function ToolActivity({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 break-words text-xs text-muted-foreground">
      {tool.activities.map((activity) => (
        <li key={`${activity.instanceId}/${activity.processId}`}>
          {t("agentTools.activity", {
            instance: activity.instanceId,
            pid: activity.processId ?? "—",
            session: activity.sessionId ?? "—",
          })}
        </li>
      ))}
      {tool.authentication.map((check) => (
        <li key={check.connectionId}>
          {t("agentTools.authentication", {
            connection: check.connectionId,
            status: t(
              check.isReady
                ? "agentTools.status.ready"
                : "agentTools.status.authentication_required",
            ),
          })}
        </li>
      ))}
    </ul>
  );
}

function ToolOutcome({
  isPending,
  result,
}: {
  readonly isPending: boolean;
  readonly result: ToolActionResult | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (isPending) return <p>{t("agentTools.working")}</p>;
  if (!result) return null;
  if (result.ok) return <p>{t("agentTools.success")}</p>;
  return (
    <p role="alert" className="text-destructive">
      {t(`agentTools.diagnostic.${result.diagnostic ?? "execution_failed"}`)}
    </p>
  );
}

function ToolSupportedVersions({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  if (tool.id === "bubblewrap") return <span>{t("agentTools.namespace")}</span>;
  if (tool.id === "pages_mcp") return <span>{t("agentTools.bundled")}</span>;
  return <span>{tool.supportedVersions.join(", ")}</span>;
}

function installationLabel(installed: boolean | null): string {
  if (installed === null) return "agentTools.unknown";
  return installed ? "agentTools.installed" : "agentTools.missing";
}

function ToolVersionFacts({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <dt className="text-muted-foreground">
        {t(
          tool.kind === "browser"
            ? "agentTools.browserVersion"
            : "agentTools.version",
        )}
      </dt>
      <dd className="break-words">{tool.installedVersion ?? "—"}</dd>
      <dt className="text-muted-foreground">
        {t(
          tool.kind === "browser"
            ? "agentTools.browserRevision"
            : "agentTools.supported",
        )}
      </dt>
      <dd className="break-words">
        <ToolSupportedVersions tool={tool} />
      </dd>
      <dt className="text-muted-foreground">
        {t(
          tool.kind === "browser"
            ? "agentTools.browserTarget"
            : "agentTools.approved",
        )}
      </dt>
      <dd>{tool.approvedVersion ?? "—"}</dd>
    </>
  );
}
