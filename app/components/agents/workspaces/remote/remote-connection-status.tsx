import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormat } from "@/app/components/common/region-provider";
import { Button } from "@/app/components/ui/button";
import { formatDateTime, formatTimeOfDay } from "@/app/lib/region-format";

import { RemoteActionMessage } from "./remote-action-message";

import type {
  RemoteActionResult,
  RemoteConnectionView,
} from "@/definition/RemoteConnection";

/** One status line with its tone and an optional second line. */
interface StatusText {
  readonly tone: "success" | "warning" | "destructive" | "muted";
  readonly text: string;
  readonly details: readonly string[];
}

const TONES = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

/** Starts a new series of at most ten attempts; the page shows its progress. */
function ReconnectButton(props: {
  readonly connectionId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<RemoteActionResult>();
  return (
    <fetcher.Form method="post" action="/agents/workspaces/remote">
      <input type="hidden" name="intent" value="reconnect" />
      <input type="hidden" name="connectionId" value={props.connectionId} />
      <Button
        type="submit"
        size="xs"
        variant="outline"
        className="mt-1.5"
        isPending={fetcher.state !== "idle"}
      >
        {t("remote.connections.reconnect")}
      </Button>
      <RemoteActionMessage result={fetcher.data} />
    </fetcher.Form>
  );
}

function useStatusText(connection: RemoteConnectionView): StatusText {
  const { t } = useTranslation();
  const region = useRegionFormat();
  const { session, lastCheck } = connection;
  const cause = session.cause
    ? [
        t("remote.status.cause", {
          cause: t(`remote.failure.${session.cause}`),
        }),
      ]
    : [];
  if (session.status === "reconnecting") {
    const next = session.nextAttemptAt
      ? t("remote.status.nextAttempt", {
          time: formatTimeOfDay(session.nextAttemptAt, region),
        })
      : t("remote.status.attemptRunning");
    const text = t("remote.status.reconnecting", {
      attempt: Math.min(session.attempts + 1, session.maximumAttempts),
      maximum: session.maximumAttempts,
    });
    return { tone: "warning", text, details: [next, ...cause] };
  }
  if (session.status === "blocked")
    return {
      tone: "destructive",
      text: t("remote.status.blocked", { maximum: session.maximumAttempts }),
      details: cause,
    };
  if (session.status === "connected")
    return { tone: "success", text: t("remote.status.connected"), details: [] };
  if (session.status === "connecting" || connection.isChecking)
    return { tone: "muted", text: t("remote.status.checking"), details: [] };
  if (!connection.hostKey)
    return {
      tone: "warning",
      text: t("remote.status.unconfirmed"),
      details: [],
    };
  if (!lastCheck)
    return { tone: "muted", text: t("remote.status.untested"), details: [] };
  const checkedAt = t("remote.status.checkedAt", {
    time: formatDateTime(lastCheck.checkedAt, region),
  });
  return lastCheck.code
    ? {
        tone: "destructive",
        text: t(`remote.failure.${lastCheck.code}`),
        details: [checkedAt],
      }
    : { tone: "success", text: t("remote.status.ready"), details: [checkedAt] };
}

/**
 * Status of a connection: the live logical connection first, then the last
 * test; a blocked series offers "Reconnect" to everyone who may use it.
 *
 * @remarks
 * Without a confirmed host key no attempt signs in, so the status asks for
 * the confirmation in the dialog instead of letting the series look helpful.
 */
export function RemoteConnectionStatus(props: {
  readonly connection: RemoteConnectionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const status = useStatusText(props.connection);
  return (
    <div className="min-w-0 text-sm">
      <p className={TONES[status.tone]}>{status.text}</p>
      {status.details.map((detail) => (
        <p key={detail} className="text-xs text-muted-foreground">
          {detail}
        </p>
      ))}
      {props.connection.hostKey === null ? (
        <p className="mt-1 text-xs font-medium text-warning">
          {t("remote.status.confirmHostKey")}
        </p>
      ) : null}
      {props.connection.session.status === "blocked" ? (
        <ReconnectButton connectionId={props.connection.id} />
      ) : null}
    </div>
  );
}
