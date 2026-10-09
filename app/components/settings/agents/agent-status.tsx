import {
  AlertCircle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Loader2,
  LogIn,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { isLoginActive } from "@/definition/AgentConnection";

import type {
  AgentCliState,
  AgentConnectionSummary,
  AgentCheckSummary,
} from "@/definition/AgentConnection";

const STATUS_STYLES = {
  unchecked: {
    icon: CircleDashed,
    className: "bg-muted text-muted-foreground",
  },
  authenticated: {
    icon: CheckCircle2,
    className: "bg-success-subtle text-success",
  },
  tested: { icon: CheckCircle2, className: "bg-success-subtle text-success" },
  failed: {
    icon: AlertCircle,
    className: "bg-destructive/10 text-destructive",
  },
  loginNeeded: { icon: LogIn, className: "bg-warning-subtle text-warning" },
  loginRunning: { icon: Loader2, className: "bg-warning-subtle text-warning" },
  missing: { icon: Ban, className: "bg-muted text-muted-foreground" },
} as const;

/** Returns the most recent persisted check without conflating access and inference. */
export function latestAgentCheck(
  connection: AgentConnectionSummary,
): AgentCheckSummary | null {
  const { auth, model } = connection.checks;
  if (!auth) return model;
  if (!model) return auth;
  return model.checkedAt >= auth.checkedAt ? model : auth;
}

/** Maps saved evidence to a status; a saved key alone never implies access. */
export function agentStatus(
  connection: AgentConnectionSummary,
): keyof typeof STATUS_STYLES {
  const cliState = cliAvailability(connection.cli);
  if (cliState) return cliState;
  const latest = latestAgentCheck(connection);
  if (latest?.status === "failed") return "failed";
  if (connection.cli && !connection.cli.loggedInAt) return "loginNeeded";
  if (
    connection.checks.model?.status === "passed" &&
    latest === connection.checks.model
  )
    return "tested";
  if (connection.checks.auth?.status === "passed" || connection.cli?.loggedInAt)
    return "authenticated";
  return "unchecked";
}

/** Presents status with both an icon and text, including the sanitized failure reason. */
export function AgentStatus({
  connection,
}: {
  readonly connection: AgentConnectionSummary;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = agentStatus(connection);
  const { icon: Icon, className } = STATUS_STYLES[status];
  const error = latestAgentCheck(connection)?.errorCode;
  const label =
    status === "authenticated" && connection.cli ? "loggedIn" : status;
  return (
    <div className="space-y-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap",
          className,
        )}
      >
        <Icon
          className={cn(
            "size-3.5",
            status === "loginRunning" && "animate-spin",
          )}
          aria-hidden="true"
        />
        {t(`settings.agents.status.${label}`)}
      </span>
      {status === "failed" && error ? (
        <p className="max-w-64 text-xs text-destructive">
          {t(`settings.agents.error.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

function cliAvailability(
  cli: AgentCliState | null,
): "missing" | "loginRunning" | null {
  if (!cli) return null;
  if (!cli.binaryFound) return "missing";
  if (cli.login && isLoginActive(cli.login.state)) return "loginRunning";
  return null;
}
