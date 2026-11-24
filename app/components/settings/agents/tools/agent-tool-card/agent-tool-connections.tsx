import { useTranslation } from "react-i18next";

import type { TFunction } from "i18next";
import type {
  AgentToolConnectionView,
  AgentToolView,
} from "@/definition/AgentTools";

const CONNECTION_STATUS: Readonly<
  Record<AgentToolConnectionView["status"], string>
> = {
  ready: "agentTools.status.ready",
  login_required: "agentTools.status.authentication_required",
  failed: "agentTools.status.failed",
};

// Without a re-binding result the sign-in checks only know a connection ID, so they are counted.
function authenticationSummary(t: TFunction, tool: AgentToolView): string {
  const ready = tool.authentication.filter((check) => check.isReady).length;
  const waiting = tool.authentication.length - ready;
  const parts = [
    ready > 0 ? `${ready} ${t("agentTools.status.ready")}` : null,
    waiting > 0
      ? `${waiting} ${t("agentTools.status.authentication_required")}`
      : null,
  ];
  return parts.filter((part) => part !== null).join(" · ") || "—";
}

function failureText(
  t: TFunction,
  connection: AgentToolConnectionView,
): string {
  const failed = t("agentTools.connections.status.failed");
  if (!connection.errorCode) return failed;
  const reason = t(`settings.agents.error.${connection.errorCode}`, {
    defaultValue: connection.errorCode,
  });
  return `${failed} (${reason})`;
}

function connectionProblems(
  t: TFunction,
  connection: AgentToolConnectionView,
): readonly string[] {
  const problems = [
    connection.status === "login_required"
      ? t("agentTools.connections.status.login_required")
      : null,
    connection.status === "failed" ? failureText(t, connection) : null,
    connection.isCatalogStale
      ? t("agentTools.connections.stale", {
          reason: t(
            `settings.agents.error.${connection.catalogErrorCode ?? "general"}`,
            { defaultValue: connection.catalogErrorCode ?? "" },
          ),
        })
      : null,
    connection.missingModel
      ? t("agentTools.connections.missingModel", {
          model: connection.missingModel,
        })
      : null,
    connection.missingReasoningEffort
      ? t("agentTools.connections.missingEffort", {
          effort: connection.missingReasoningEffort,
        })
      : null,
  ];
  return problems
    .filter((problem) => problem !== null)
    .map((problem) => `${connection.name}: ${problem}`);
}

/**
 * The value of the fact "Verbindungen": every connection with its state after re-binding.
 * @remarks
 * Before a re-binding only the sign-in checks are known, which name no
 * connection, so the value counts ready and waiting ones.
 */
export function AgentToolConnectionsFact({
  tool,
}: {
  readonly tool: AgentToolView;
}): React.ReactElement {
  const { t } = useTranslation();
  if (tool.connections.length === 0)
    return <>{authenticationSummary(t, tool)}</>;
  return (
    <>
      {tool.connections
        .map(
          (connection) =>
            `${connection.name} · ${t(CONNECTION_STATUS[connection.status])}`,
        )
        .join(", ")}
    </>
  );
}

/**
 * Lists what went wrong with a connection after re-binding, one entry per problem.
 * @remarks
 * A saved model or reasoning level that the new catalog no longer offers is
 * named, never replaced. Renders list items for the problem list of a row.
 */
export function AgentToolConnectionProblems({
  connections,
}: {
  readonly connections: readonly AgentToolConnectionView[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {connections.flatMap((connection) =>
        connectionProblems(t, connection).map((problem) => (
          <li key={`${connection.connectionId}/${problem}`}>{problem}</li>
        )),
      )}
    </>
  );
}
